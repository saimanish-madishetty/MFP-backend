import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { addDays, formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateBillDto,
  CreateExpenseDto,
  PayBillDto,
  UpdateBillDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';

const Decimal = Prisma.Decimal;

/** Unpaid bills due within this many days count as "due soon" on the dashboard. */
const DUE_SOON_DAYS = 7;

function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month))
    throw new BadRequestException('month must be YYYY-MM');
  const from = parseDate(`${month}-01`);
  const to = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
  );
  return { from, to };
}

function notFuture(date: Date) {
  if (date > todayIST())
    throw new BadRequestException('Date cannot be in the future');
  return date;
}

/** Miscellaneous expenses (paid as they happen) and bills (paid by a due date). */
@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Expenses ──────────────────────────────────────────────

  async listExpenses(month: string) {
    const { from, to } = monthRange(month);
    const items = await this.prisma.expense.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    });
    const byCategory = new Map<string, Prisma.Decimal>();
    let total = new Decimal(0);
    for (const e of items) {
      total = total.add(e.amount);
      byCategory.set(
        e.category,
        (byCategory.get(e.category) ?? new Decimal(0)).add(e.amount),
      );
    }
    return {
      month,
      total: total.toFixed(2),
      byCategory: [...byCategory]
        .map(([category, sum]) => ({ category, total: sum.toFixed(2) }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
      items: items.map((e) => ({ ...e, date: formatDate(e.date) })),
    };
  }

  /** Past categories, most used first, for suggestions. */
  async categories() {
    const rows = await this.prisma.expense.groupBy({
      by: ['category'],
      _count: { category: true },
      orderBy: { _count: { category: 'desc' } },
      take: 30,
    });
    return rows.map((r) => r.category);
  }

  createExpense(dto: CreateExpenseDto) {
    return this.prisma.expense.create({
      data: {
        date: notFuture(parseDate(dto.date)),
        amount: dto.amount,
        category: dto.category.trim(),
        note: dto.note?.trim() || null,
        mode: dto.mode,
      },
    });
  }

  async updateExpense(id: number, dto: UpdateExpenseDto) {
    await this.findExpense(id);
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.date && { date: notFuture(parseDate(dto.date)) }),
        amount: dto.amount,
        category: dto.category?.trim(),
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        mode: dto.mode,
      },
    });
  }

  async deleteExpense(id: number) {
    await this.findExpense(id);
    await this.prisma.expense.delete({ where: { id } });
  }

  // ── Bills ─────────────────────────────────────────────────

  /** `status`: unpaid (default, soonest due first), paid (latest first) or all. */
  async listBills(status = 'unpaid') {
    const today = todayIST();
    const bills = await this.prisma.bill.findMany({
      where:
        status === 'paid'
          ? { paidOn: { not: null } }
          : status === 'all'
            ? {}
            : { paidOn: null },
      orderBy:
        status === 'paid'
          ? [{ paidOn: 'desc' }, { id: 'desc' }]
          : [{ dueDate: 'asc' }, { id: 'asc' }],
      take: 300,
    });
    return bills.map((b) => ({
      ...b,
      billDate: b.billDate && formatDate(b.billDate),
      dueDate: formatDate(b.dueDate),
      paidOn: b.paidOn && formatDate(b.paidOn),
      overdue: b.paidOn === null && b.dueDate < today,
    }));
  }

  createBill(dto: CreateBillDto) {
    return this.prisma.bill.create({
      data: {
        name: dto.name.trim(),
        amount: dto.amount,
        billDate: dto.billDate ? parseDate(dto.billDate) : null,
        dueDate: parseDate(dto.dueDate),
        note: dto.note?.trim() || null,
      },
    });
  }

  async updateBill(id: number, dto: UpdateBillDto) {
    await this.findBill(id);
    return this.prisma.bill.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        amount: dto.amount,
        billDate:
          dto.billDate === undefined
            ? undefined
            : dto.billDate
              ? parseDate(dto.billDate)
              : null,
        ...(dto.dueDate && { dueDate: parseDate(dto.dueDate) }),
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
      },
    });
  }

  async payBill(id: number, dto: PayBillDto) {
    const bill = await this.findBill(id);
    if (bill.paidOn) throw new BadRequestException('This bill is already paid');
    return this.prisma.bill.update({
      where: { id },
      data: {
        paidOn: notFuture(parseDate(dto.paidOn)),
        mode: dto.mode,
        reference: dto.reference?.trim() || null,
      },
    });
  }

  /** Marks a paid bill as unpaid again (paid by mistake). */
  async unpayBill(id: number) {
    await this.findBill(id);
    return this.prisma.bill.update({
      where: { id },
      data: { paidOn: null, mode: null, reference: null },
    });
  }

  async deleteBill(id: number) {
    await this.findBill(id);
    await this.prisma.bill.delete({ where: { id } });
  }

  // ── Dashboard ─────────────────────────────────────────────

  async overview() {
    const today = todayIST();
    const { from, to } = monthRange(formatDate(today).slice(0, 7));
    const [month, todayAgg, paidBills, unpaid] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { date: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.expense.aggregate({
        where: { date: today },
        _sum: { amount: true },
      }),
      this.prisma.bill.aggregate({
        where: { paidOn: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      this.prisma.bill.findMany({
        where: {
          paidOn: null,
          dueDate: { lte: addDays(today, DUE_SOON_DAYS) },
        },
        orderBy: { dueDate: 'asc' },
      }),
    ]);
    const sum = (rows: { amount: Prisma.Decimal }[]) =>
      rows.reduce((a, b) => a.add(b.amount), new Decimal(0)).toFixed(2);
    const overdue = unpaid.filter((b) => b.dueDate < today);
    return {
      expensesToday: new Decimal(todayAgg._sum.amount ?? 0).toFixed(2),
      expensesMonth: {
        amount: new Decimal(month._sum.amount ?? 0).toFixed(2),
        count: month._count,
      },
      billsPaidMonth: new Decimal(paidBills._sum.amount ?? 0).toFixed(2),
      billsDue: {
        count: unpaid.length,
        amount: sum(unpaid),
        overdueCount: overdue.length,
        overdueAmount: sum(overdue),
        next: unpaid.slice(0, 3).map((b) => ({
          id: b.id,
          name: b.name,
          amount: b.amount.toFixed(2),
          dueDate: formatDate(b.dueDate),
        })),
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────

  private async findExpense(id: number) {
    const e = await this.prisma.expense.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Expense not found');
    return e;
  }

  private async findBill(id: number) {
    const b = await this.prisma.bill.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Bill not found');
    return b;
  }
}
