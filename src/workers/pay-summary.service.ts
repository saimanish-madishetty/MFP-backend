import { Injectable } from '@nestjs/common';
import { Prisma, Worker } from '../generated/prisma/client.js';
import { addDays, eachDay, formatDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STATUS_FACTOR, nextPayDate } from './pay.js';

type Db = PrismaService | Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

export type PaySummary = Awaited<ReturnType<PaySummaryService['summarize']>>;

/**
 * Pay is computed from the worker's full history:
 *   payable = Σ attendance.earned − Σ settlement.amountPaid − Σ advance.amount
 * "This period" figures are only a breakdown of that number for display.
 */
@Injectable()
export class PaySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(
    worker: Worker,
    upTo: Date = todayIST(),
    db: Db = this.prisma,
  ) {
    const lastSettlement = await db.settlement.findFirst({
      where: { workerId: worker.id },
      orderBy: { periodEnd: 'desc' },
    });
    const periodStart = lastSettlement
      ? addDays(lastSettlement.periodEnd, 1)
      : worker.joiningDate;

    const [
      earnedAll,
      paidAll,
      advancesAll,
      periodDays,
      advancesPeriod,
      pendingChanges,
    ] = await Promise.all([
      db.attendance.aggregate({
        where: { workerId: worker.id, date: { lte: upTo } },
        _sum: { earned: true },
      }),
      db.settlement.aggregate({
        where: { workerId: worker.id },
        _sum: { amountPaid: true },
      }),
      db.advance.aggregate({
        where: { workerId: worker.id, date: { lte: upTo } },
        _sum: { amount: true },
      }),
      db.attendance.findMany({
        where: { workerId: worker.id, date: { gte: periodStart, lte: upTo } },
        select: { date: true, status: true, bonus: true, earned: true },
      }),
      db.advance.aggregate({
        where: { workerId: worker.id, date: { gte: periodStart, lte: upTo } },
        _sum: { amount: true },
      }),
      db.attendanceChange.findMany({
        where: { workerId: worker.id, reportedInSettlementId: null },
        orderBy: { changedAt: 'asc' },
      }),
    ]);

    const payable = new Decimal(earnedAll._sum.earned ?? 0)
      .sub(paidAll._sum.amountPaid ?? 0)
      .sub(advancesAll._sum.amount ?? 0);

    const counts = { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, PAID_LEAVE: 0 };
    let daysWorked = 0;
    let periodEarned = new Decimal(0);
    let periodBonus = new Decimal(0);
    const marked = new Set<string>();
    for (const day of periodDays) {
      counts[day.status] += 1;
      daysWorked += STATUS_FACTOR[day.status];
      periodEarned = periodEarned.add(day.earned);
      periodBonus = periodBonus.add(day.bonus);
      marked.add(formatDate(day.date));
    }
    const periodAdvances = new Decimal(advancesPeriod._sum.amount ?? 0);
    const broughtForward = payable.sub(periodEarned.sub(periodAdvances));

    const unmarkedDays =
      periodStart <= upTo
        ? eachDay(periodStart, upTo)
            .map(formatDate)
            .filter((d) => !marked.has(d))
        : [];

    const payDate = nextPayDate(worker, periodStart);

    return {
      periodStart: formatDate(periodStart),
      upTo: formatDate(upTo),
      lastSettledOn: lastSettlement
        ? formatDate(lastSettlement.periodEnd)
        : null,
      counts,
      daysWorked,
      earned: periodEarned.sub(periodBonus).toFixed(2),
      bonus: periodBonus.toFixed(2),
      advances: periodAdvances.toFixed(2),
      broughtForward: broughtForward.toFixed(2),
      payable: payable.toFixed(2),
      unmarkedDays,
      pendingChanges: pendingChanges.map((c) => ({
        id: c.id,
        date: formatDate(c.date),
        oldStatus: c.oldStatus,
        oldBonus: c.oldBonus.toFixed(2),
        newStatus: c.newStatus,
        newBonus: c.newBonus.toFixed(2),
        difference: c.difference.toFixed(2),
        changedAt: c.changedAt,
      })),
      nextPayDate: payDate ? formatDate(payDate) : null,
      payDue: payDate !== null && payDate <= todayIST(),
    };
  }
}
