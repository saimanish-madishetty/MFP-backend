import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SalePaymentStatus } from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto } from './dto/buyer.dto.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;
const Decimal = Prisma.Decimal;

/** Not cancelled. */
export const ACTIVE_SALE = {
  cancelledAt: null,
} satisfies Prisma.SaleWhereInput;

/** Unpaid or part paid, past due date. */
export const overdueWhere = (): Prisma.SaleWhereInput => ({
  ...ACTIVE_SALE,
  paymentStatus: { not: SalePaymentStatus.PAID },
  dueDate: { lt: todayIST() },
});

/** Re-derives a sale's amountPaid and payment status from its allocations. */
export async function recalcSale(tx: Tx, saleId: number) {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId } });
  const agg = await tx.paymentAllocation.aggregate({
    where: { saleId },
    _sum: { amount: true },
  });
  const paid = new Decimal(agg._sum.amount ?? 0);
  const status = paid.gte(sale.grandTotal)
    ? SalePaymentStatus.PAID
    : paid.gt(0)
      ? SalePaymentStatus.PARTIAL
      : SalePaymentStatus.UNPAID;
  await tx.sale.update({
    where: { id: saleId },
    data: { amountPaid: paid, paymentStatus: status },
  });
}

/**
 * Buyer balances and payments.
 * Balance = opening balance + Σ invoices (not cancelled) − Σ payments.
 * Allocations only decide which invoices show as paid.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async balances(buyerIds?: number[]) {
    const where = buyerIds ? { buyerId: { in: buyerIds } } : {};
    const [buyers, sales, payments, overdue] = await Promise.all([
      this.prisma.buyer.findMany({
        where: buyerIds ? { id: { in: buyerIds } } : {},
        select: { id: true, openingBalance: true },
      }),
      this.prisma.sale.groupBy({
        by: ['buyerId'],
        where: { ...where, ...ACTIVE_SALE },
        _sum: { grandTotal: true },
      }),
      this.prisma.payment.groupBy({
        by: ['buyerId'],
        where,
        _sum: { amount: true },
      }),
      this.prisma.sale.groupBy({
        by: ['buyerId'],
        where: { ...where, ...overdueWhere() },
        _sum: { grandTotal: true, amountPaid: true },
        _count: true,
      }),
    ]);
    const salesBy = new Map(sales.map((s) => [s.buyerId, s._sum.grandTotal]));
    const paidBy = new Map(payments.map((p) => [p.buyerId, p._sum.amount]));
    const overdueBy = new Map(overdue.map((o) => [o.buyerId, o]));

    return new Map(
      buyers.map((b) => {
        const totalSales = new Decimal(salesBy.get(b.id) ?? 0);
        const totalPaid = new Decimal(paidBy.get(b.id) ?? 0);
        const o = overdueBy.get(b.id);
        return [
          b.id,
          {
            totalSales: totalSales.toFixed(2),
            totalPaid: totalPaid.toFixed(2),
            balance: b.openingBalance.add(totalSales).sub(totalPaid).toFixed(2),
            overdueAmount: o
              ? new Decimal(o._sum.grandTotal ?? 0)
                  .sub(o._sum.amountPaid ?? 0)
                  .toFixed(2)
              : '0.00',
            overdueCount: o?._count ?? 0,
          },
        ];
      }),
    );
  }

  async balance(buyerId: number) {
    const map = await this.balances([buyerId]);
    const b = map.get(buyerId);
    if (!b) throw new NotFoundException('Buyer not found');
    return b;
  }

  async createPayment(buyerId: number, dto: CreatePaymentDto, db?: Tx) {
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');
    const run = async (tx: Tx) => {
      const buyer = await tx.buyer.findUnique({ where: { id: buyerId } });
      if (!buyer) throw new NotFoundException('Buyer not found');
      const payment = await tx.payment.create({
        data: {
          buyerId,
          date,
          amount: dto.amount,
          mode: dto.mode,
          reference: dto.reference?.trim() || null,
          note: dto.note?.trim() || null,
        },
      });
      await this.allocate(
        tx,
        buyerId,
        payment.id,
        new Decimal(dto.amount),
        dto.allocations,
      );
      return payment;
    };
    return db ? run(db) : this.prisma.$transaction(run);
  }

  async deletePayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: paymentId } });
      for (const a of payment.allocations) await recalcSale(tx, a.saleId);
      await this.reconcile(tx, payment.buyerId);
    });
  }

  /** Applies a payment to the invoices asked for, or else oldest dues first. */
  private async allocate(
    tx: Tx,
    buyerId: number,
    paymentId: number,
    amount: Prisma.Decimal,
    requested?: { saleId: number; amount: number }[],
  ) {
    if (!requested) return this.reconcile(tx, buyerId);

    const open = await tx.sale.findMany({
      where: {
        buyerId,
        ...ACTIVE_SALE,
        paymentStatus: { not: SalePaymentStatus.PAID },
        id: { in: requested.map((r) => r.saleId) },
      },
    });
    let total = new Decimal(0);
    for (const r of requested) {
      const sale = open.find((s) => s.id === r.saleId);
      if (!sale)
        throw new BadRequestException(
          `Invoice ${r.saleId} is not an unpaid invoice of this buyer`,
        );
      const due = sale.grandTotal.sub(sale.amountPaid);
      if (new Decimal(r.amount).gt(due))
        throw new BadRequestException(
          `${sale.invoiceNumber}: only ${due.toFixed(2)} is due`,
        );
      total = total.add(r.amount);
    }
    if (total.gt(amount))
      throw new BadRequestException(
        'Amounts for invoices add up to more than the payment',
      );
    for (const r of requested) {
      await tx.paymentAllocation.create({
        data: { paymentId, saleId: r.saleId, amount: r.amount },
      });
      await recalcSale(tx, r.saleId);
    }
  }

  /**
   * Applies any unused payment money to the buyer's unpaid invoices, oldest first.
   * Unused money covers the opening balance first (it is the oldest due).
   * Called after payments, new or edited invoices, and cancellations.
   */
  async reconcile(tx: Tx, buyerId: number) {
    const [buyer, payments, open] = await Promise.all([
      tx.buyer.findUniqueOrThrow({ where: { id: buyerId } }),
      tx.payment.findMany({
        where: { buyerId },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        include: { allocations: { select: { amount: true } } },
      }),
      tx.sale.findMany({
        where: {
          buyerId,
          ...ACTIVE_SALE,
          paymentStatus: { not: SalePaymentStatus.PAID },
        },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const unused = payments.map((p) => ({
      id: p.id,
      left: p.allocations.reduce((sum, a) => sum.sub(a.amount), p.amount),
    }));
    // Money reserved for the opening balance is skipped from the oldest payments.
    let reserve = Decimal.max(buyer.openingBalance, 0);
    for (const p of unused) {
      const take = Decimal.min(reserve, p.left);
      p.left = p.left.sub(take);
      reserve = reserve.sub(take);
    }

    for (const sale of open) {
      let due = sale.grandTotal.sub(sale.amountPaid);
      for (const p of unused) {
        if (due.lte(0)) break;
        if (p.left.lte(0)) continue;
        const amt = Decimal.min(due, p.left);
        await tx.paymentAllocation.upsert({
          where: { paymentId_saleId: { paymentId: p.id, saleId: sale.id } },
          create: { paymentId: p.id, saleId: sale.id, amount: amt },
          update: { amount: { increment: amt } },
        });
        p.left = p.left.sub(amt);
        due = due.sub(amt);
      }
      if (due.lt(sale.grandTotal.sub(sale.amountPaid)))
        await recalcSale(tx, sale.id);
    }
  }

  /** Sales and payments of a buyer, newest first. */
  async timeline(buyerId: number, db: Db = this.prisma) {
    const [sales, payments] = await Promise.all([
      db.sale.findMany({
        where: { buyerId },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          invoiceNumber: true,
          date: true,
          dueDate: true,
          grandTotal: true,
          amountPaid: true,
          paymentStatus: true,
          cancelledAt: true,
        },
      }),
      db.payment.findMany({
        where: { buyerId },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        include: {
          allocations: {
            include: { sale: { select: { id: true, invoiceNumber: true } } },
          },
        },
      }),
    ]);
    const today = todayIST();
    const items = [
      ...sales.map((s) => ({
        kind: 'SALE' as const,
        id: s.id,
        date: formatDate(s.date),
        invoiceNumber: s.invoiceNumber,
        amount: s.grandTotal.toFixed(2),
        amountPaid: s.amountPaid.toFixed(2),
        paymentStatus: s.paymentStatus,
        dueDate: formatDate(s.dueDate),
        overdue:
          !s.cancelledAt &&
          s.paymentStatus !== SalePaymentStatus.PAID &&
          s.dueDate < today,
        cancelled: s.cancelledAt !== null,
      })),
      ...payments.map((p) => ({
        kind: 'PAYMENT' as const,
        id: p.id,
        date: formatDate(p.date),
        amount: p.amount.toFixed(2),
        mode: p.mode,
        reference: p.reference,
        note: p.note,
        allocations: p.allocations.map((a) => ({
          saleId: a.sale.id,
          invoiceNumber: a.sale.invoiceNumber,
          amount: a.amount.toFixed(2),
        })),
      })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }
}
