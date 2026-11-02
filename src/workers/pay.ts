import {
  AttendanceStatus,
  PayCycle,
  PayType,
  Prisma,
} from '../generated/prisma/client.js';
import { addDays, daysInMonth } from '../common/dates.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

export const STATUS_FACTOR: Record<AttendanceStatus, number> = {
  PRESENT: 1,
  HALF_DAY: 0.5,
  ABSENT: 0,
  PAID_LEAVE: 1,
};

/** What one full day is worth for this worker right now. */
export function dayValueFor(worker: {
  payType: PayType;
  rate: Decimal;
  workingDaysPerMonth: number | null;
}): Decimal {
  if (worker.payType === PayType.DAILY) return new Decimal(worker.rate);
  const days = worker.workingDaysPerMonth || 26;
  return new Decimal(worker.rate).div(days).toDecimalPlaces(2);
}

/** Amount earned for one attendance day. */
export function earnedFor(
  dayValue: Decimal,
  status: AttendanceStatus | null,
  bonus: Decimal,
): Decimal {
  if (status === null) return new Decimal(0);
  return new Decimal(dayValue)
    .mul(STATUS_FACTOR[status])
    .toDecimalPlaces(2)
    .add(bonus);
}

/**
 * First pay date after `periodStart`, based on the worker's pay cycle.
 * (A period starting on a pay day is paid on the next one.)
 * Returns null for MANUAL or incomplete settings.
 */
export function nextPayDate(
  worker: {
    payCycle: PayCycle;
    payWeekday: number | null;
    payMonthDay: number | null;
  },
  periodStart: Date,
): Date | null {
  if (worker.payCycle === PayCycle.WEEKLY && worker.payWeekday !== null) {
    const diff = (worker.payWeekday - periodStart.getUTCDay() + 7) % 7 || 7;
    return addDays(periodStart, diff);
  }
  if (worker.payCycle === PayCycle.MONTHLY && worker.payMonthDay !== null) {
    let year = periodStart.getUTCFullYear();
    let month = periodStart.getUTCMonth();
    for (;;) {
      const day = Math.min(worker.payMonthDay, daysInMonth(year, month));
      const candidate = new Date(Date.UTC(year, month, day));
      if (candidate > periodStart) return candidate;
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
  }
  return null;
}
