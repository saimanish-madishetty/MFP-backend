import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceType,
  Prisma,
  ProductMovementType,
  SalePaymentStatus,
} from '../generated/prisma/client.js';
import { addDays, formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACTIVE_SALE,
  LedgerService,
  overdueWhere,
  recalcSale,
} from '../buyers/ledger.service.js';
import {
  applyProductMovement,
  reverseProductMovement,
} from '../products/product-stock.js';
import {
  packDescription,
  sellUnits,
  toStock,
  unitsLabel,
} from '../products/packaging.js';
import { SettingsService } from '../settings/settings.js';
import { CancelSaleDto, MarkPaidDto, SaveSaleDto } from './dto/sale.dto.js';
import {
  financialYear,
  invoiceNumber,
  invoiceTotals,
  lineAmounts,
  sameState,
} from './invoice-math.js';

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

export type SaleListQuery = {
  status?: string;
  buyerId?: number;
  /** Invoices with this product on a line */
  productId?: number;
  from?: string;
  to?: string;
  q?: string;
};

export type SaleSort = 'new' | 'old' | 'high' | 'low';

const SORTS: Record<SaleSort, Prisma.SaleOrderByWithRelationInput[]> = {
  new: [{ date: 'desc' }, { sequence: 'desc' }],
  old: [{ date: 'asc' }, { sequence: 'asc' }],
  high: [{ grandTotal: 'desc' }, { date: 'desc' }, { sequence: 'desc' }],
  low: [{ grandTotal: 'asc' }, { date: 'desc' }, { sequence: 'desc' }],
};

const LIST_SELECT = {
  id: true,
  invoiceNumber: true,
  date: true,
  dueDate: true,
  buyerId: true,
  buyerName: true,
  grandTotal: true,
  amountPaid: true,
  paymentStatus: true,
  cancelledAt: true,
  _count: { select: { lines: true } },
} satisfies Prisma.SaleSelect;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: SaleListQuery) {
    const sales = await this.prisma.sale.findMany({
      where: this.listWhere(query),
      orderBy: SORTS.new,
      take: 300,
      select: LIST_SELECT,
    });
    return this.listItems(sales);
  }

  /**
   * One page of invoices matching the filters, plus totals over *all* matches (not just the page):
   * how many, their value and what's still due (cancelled invoices count but add no money).
   */
  async search(
    query: SaleListQuery & { sort?: SaleSort; offset?: number; limit?: number },
  ) {
    const where = this.listWhere(query);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const [sales, count, sums] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: SORTS[query.sort ?? 'new'] ?? SORTS.new,
        skip: offset,
        take: limit,
        select: LIST_SELECT,
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where: { AND: [where, ACTIVE_SALE] },
        _sum: { grandTotal: true, amountPaid: true },
      }),
    ]);
    const total = new Decimal(sums._sum.grandTotal ?? 0);
    const paid = new Decimal(sums._sum.amountPaid ?? 0);
    return {
      items: this.listItems(sales),
      count,
      total: total.toFixed(2),
      due: Decimal.max(total.sub(paid), 0).toFixed(2),
      hasMore: offset + sales.length < count,
    };
  }

  private listItems(
    sales: Prisma.SaleGetPayload<{ select: typeof LIST_SELECT }>[],
  ) {
    const today = todayIST();
    return sales.map((s) => ({
      ...s,
      date: formatDate(s.date),
      dueDate: formatDate(s.dueDate),
      overdue:
        !s.cancelledAt &&
        s.paymentStatus !== SalePaymentStatus.PAID &&
        s.dueDate < today,
    }));
  }

  private listWhere(query: SaleListQuery): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {
      ...(query.buyerId && { buyerId: query.buyerId }),
      ...(query.productId && {
        lines: { some: { productId: query.productId } },
      }),
      ...((query.from || query.to) && {
        date: {
          ...(query.from && { gte: parseDate(query.from) }),
          ...(query.to && { lte: parseDate(query.to) }),
        },
      }),
      // Every word must match the invoice number or the buyer, in any order ("kumar 0012").
      ...(query.q && {
        AND: query.q
          .split(/\s+/)
          .filter(Boolean)
          .map((w) => ({
            OR: [
              { invoiceNumber: { contains: w, mode: 'insensitive' as const } },
              { buyerName: { contains: w, mode: 'insensitive' as const } },
            ],
          })),
      }),
    };
    if (query.status === 'UNPAID')
      Object.assign(where, ACTIVE_SALE, {
        paymentStatus: { not: SalePaymentStatus.PAID },
      });
    else if (query.status === 'OVERDUE') Object.assign(where, overdueWhere());
    else if (query.status === 'PAID')
      Object.assign(where, ACTIVE_SALE, {
        paymentStatus: SalePaymentStatus.PAID,
      });
    else if (query.status === 'CANCELLED') where.cancelledAt = { not: null };
    return where;
  }

  async get(id: number) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { product: { select: { internalName: true } } },
        },
        allocations: {
          include: {
            payment: {
              select: {
                id: true,
                date: true,
                mode: true,
                reference: true,
                amount: true,
              },
            },
          },
        },
        buyer: true,
      },
    });
    if (!sale) throw new NotFoundException('Invoice not found');
    const balance = await this.ledger.balance(sale.buyerId);
    // What the buyer owes apart from this invoice (for "previous balance" on the PDF).
    const thisDue = sale.cancelledAt
      ? new Decimal(0)
      : sale.grandTotal.sub(sale.amountPaid);
    return {
      ...sale,
      date: formatDate(sale.date),
      dueDate: formatDate(sale.dueDate),
      overdue:
        !sale.cancelledAt &&
        sale.paymentStatus !== SalePaymentStatus.PAID &&
        sale.dueDate < todayIST(),
      buyerBalance: balance.balance,
      previousBalance: new Decimal(balance.balance).sub(thisDue).toFixed(2),
    };
  }

  async create(dto: SaveSaleDto) {
    const id = await this.prisma.$transaction(async (tx) => {
      const prepared = await this.prepare(tx, dto);
      const fy = financialYear(prepared.date);
      const counter = await tx.invoiceCounter.upsert({
        where: { financialYear: fy },
        create: { financialYear: fy, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const sale = await tx.sale.create({
        data: {
          ...prepared.data,
          invoiceNumber: invoiceNumber(
            prepared.company.invoicePrefix,
            fy,
            counter.lastNumber,
          ),
          financialYear: fy,
          sequence: counter.lastNumber,
          lines: { create: prepared.lines },
        },
      });
      await this.recordStock(tx, sale.id, prepared);
      if (dto.paidNow) {
        if (new Decimal(dto.paidNow.amount).gt(sale.grandTotal)) {
          throw new BadRequestException(
            'Amount received is more than the invoice total',
          );
        }
        await this.ledger.createPayment(
          sale.buyerId,
          {
            date: dto.date,
            amount: dto.paidNow.amount,
            mode: dto.paidNow.mode,
            reference: dto.paidNow.reference,
            allocations: [{ saleId: sale.id, amount: dto.paidNow.amount }],
          },
          tx,
        );
      }
      await this.ledger.reconcile(tx, sale.buyerId);
      return sale.id;
    });
    return this.get(id);
  }

  /** Rewrites an invoice in place (same number). Stock is re-applied; payments stay. */
  async update(id: number, dto: SaveSaleDto) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.sale.findUnique({
        where: { id },
        include: { stockMovements: true },
      });
      if (!existing) throw new NotFoundException('Invoice not found');
      if (existing.cancelledAt)
        throw new BadRequestException('A cancelled invoice cannot be edited');
      if (existing.buyerId !== dto.buyerId && existing.amountPaid.gt(0)) {
        throw new BadRequestException(
          'This invoice has payments. Remove them before changing the buyer.',
        );
      }
      const prepared = await this.prepare(tx, dto);
      if (financialYear(prepared.date) !== existing.financialYear) {
        throw new BadRequestException(
          `The date must stay in financial year ${existing.financialYear}`,
        );
      }
      if (existing.amountPaid.gt(prepared.data.grandTotal)) {
        throw new BadRequestException(
          `₹${existing.amountPaid.toFixed(2)} is already paid, more than the new total. Remove a payment first.`,
        );
      }
      for (const m of existing.stockMovements)
        await reverseProductMovement(tx, m);
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      await tx.sale.update({
        where: { id },
        data: { ...prepared.data, lines: { create: prepared.lines } },
      });
      await this.recordStock(tx, id, prepared);
      await recalcSale(tx, id);
      await this.ledger.reconcile(tx, dto.buyerId);
    });
    return this.get(id);
  }

  /** Keeps the number; puts stock back; payments are released to the buyer's account. */
  async cancel(id: number, dto: CancelSaleDto) {
    await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!sale) throw new NotFoundException('Invoice not found');
      if (sale.cancelledAt) throw new BadRequestException('Already cancelled');
      for (const line of sale.lines) {
        await applyProductMovement(tx, {
          productId: line.productId,
          date: todayIST(),
          type: ProductMovementType.SALE_CANCELLED,
          quantity: line.stockQty,
          saleId: id,
          note: `${sale.invoiceNumber} cancelled`,
        });
      }
      await tx.paymentAllocation.deleteMany({ where: { saleId: id } });
      await tx.sale.update({
        where: { id },
        data: {
          cancelledAt: new Date(),
          cancelReason: dto.reason.trim(),
          amountPaid: 0,
          paymentStatus: SalePaymentStatus.UNPAID,
        },
      });
      await this.ledger.reconcile(tx, sale.buyerId);
    });
    return this.get(id);
  }

  /** Records a payment for whatever is still due on the invoice. */
  async markPaid(id: number, dto: MarkPaidDto) {
    const sale = await this.prisma.sale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException('Invoice not found');
    if (sale.cancelledAt) throw new BadRequestException('Invoice is cancelled');
    const due = sale.grandTotal.sub(sale.amountPaid);
    if (due.lte(0)) throw new BadRequestException('Already fully paid');
    await this.ledger.createPayment(sale.buyerId, {
      date: dto.date,
      amount: due.toNumber(),
      mode: dto.mode,
      reference: dto.reference,
      allocations: [{ saleId: id, amount: due.toNumber() }],
    });
    return this.get(id);
  }

  async overview() {
    const today = todayIST();
    const monthStart = parseDate(formatDate(today).slice(0, 8) + '01');
    const [todayAgg, monthAgg, recent] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { ...ACTIVE_SALE, date: today },
        _sum: { grandTotal: true },
        _count: true,
      }),
      this.prisma.sale.aggregate({
        where: { ...ACTIVE_SALE, date: { gte: monthStart, lte: today } },
        _sum: { grandTotal: true },
        _count: true,
      }),
      this.list({}),
    ]);
    return {
      today: {
        amount: new Decimal(todayAgg._sum.grandTotal ?? 0).toFixed(2),
        count: todayAgg._count,
      },
      month: {
        amount: new Decimal(monthAgg._sum.grandTotal ?? 0).toFixed(2),
        count: monthAgg._count,
      },
      recent: recent.slice(0, 5),
    };
  }

  // ── Helpers ───────────────────────────────────────────────

  /** Validates input and computes every amount for the invoice. */
  private async prepare(tx: Tx, dto: SaveSaleDto) {
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');
    const [buyer, company, products] = await Promise.all([
      tx.buyer.findUnique({ where: { id: dto.buyerId } }),
      this.settings.company(),
      tx.product.findMany({
        where: { id: { in: dto.lines.map((l) => l.productId) } },
      }),
    ]);
    if (!buyer) throw new BadRequestException('Buyer not found');
    const productById = new Map(products.map((p) => [p.id, p]));

    const taxed = company.gstin !== null;
    const interState = taxed && !sameState(company.state, buyer.state);
    const lines = dto.lines.map((l, i) => {
      const product = productById.get(l.productId);
      if (!product)
        throw new BadRequestException(`Item ${i + 1}: product not found`);
      const unit = l.unit ?? product.saleUnit;
      if (!sellUnits(product).includes(unit))
        throw new BadRequestException(
          `Item ${i + 1}: ${product.publicName} is sold by ${unitsLabel(sellUnits(product))}`,
        );
      if (
        new Decimal(l.discount ?? 0).gt(new Decimal(l.quantity).mul(l.rate))
      ) {
        throw new BadRequestException(
          `Item ${i + 1}: discount is more than the amount`,
        );
      }
      const gstRate = taxed
        ? (product.gstRate ?? new Decimal(0))
        : new Decimal(0);
      const amounts = lineAmounts(
        { quantity: l.quantity, rate: l.rate, discount: l.discount, gstRate },
        { pricesIncludeGst: company.pricesIncludeGst, interState },
      );
      return {
        lineNo: i + 1,
        productId: product.id,
        publicName: product.publicName,
        description: packDescription(product),
        hsnCode: product.hsnCode,
        quantity: l.quantity,
        unit,
        stockQty: toStock(product, l.quantity, unit),
        rate: l.rate,
        discount: amounts.discount,
        taxableValue: amounts.taxableValue,
        gstRate,
        cgst: amounts.cgst,
        sgst: amounts.sgst,
        igst: amounts.igst,
        lineTotal: amounts.lineTotal,
        _amounts: amounts,
      };
    });
    const totals = invoiceTotals(lines.map((l) => l._amounts));
    const creditDays = buyer.creditDays ?? company.defaultCreditDays;
    const address = [buyer.address, buyer.city, buyer.state, buyer.pincode]
      .filter(Boolean)
      .join(', ');

    return {
      date,
      company,
      lines: lines.map(({ _amounts, ...rest }) => rest),
      data: {
        type: taxed ? InvoiceType.TAX_INVOICE : InvoiceType.BILL,
        date,
        dueDate: addDays(date, creditDays),
        buyerId: buyer.id,
        buyerName: buyer.invoiceName ?? buyer.name,
        buyerAddress: address || null,
        buyerPhone: buyer.phone,
        buyerGstin: buyer.gstin,
        placeOfSupply: buyer.state ?? company.state,
        isInterState: interState,
        ...totals,
        notes: dto.notes?.trim() || null,
      },
    };
  }

  private async recordStock(
    tx: Tx,
    saleId: number,
    prepared: Awaited<ReturnType<SalesService['prepare']>>,
  ) {
    for (const line of prepared.lines) {
      await applyProductMovement(tx, {
        productId: line.productId,
        date: prepared.date,
        type: ProductMovementType.SOLD,
        quantity: line.stockQty.neg(),
        saleId,
      });
    }
  }
}
