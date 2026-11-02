import { Prisma } from '../generated/prisma/client.js';
import { parseDate, formatDate } from '../common/dates.js';
import { dayValueFor, earnedFor, nextPayDate } from './pay.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('dayValueFor', () => {
  it('uses the daily rate for daily workers', () => {
    const v = dayValueFor({
      payType: 'DAILY',
      rate: D(600),
      workingDaysPerMonth: null,
    });
    expect(v.toString()).toBe('600');
  });

  it('divides the salary by working days for monthly workers', () => {
    const v = dayValueFor({
      payType: 'MONTHLY',
      rate: D(15600),
      workingDaysPerMonth: 26,
    });
    expect(v.toString()).toBe('600');
  });

  it('rounds to paise', () => {
    const v = dayValueFor({
      payType: 'MONTHLY',
      rate: D(10000),
      workingDaysPerMonth: 26,
    });
    expect(v.toFixed(2)).toBe('384.62');
  });
});

describe('earnedFor', () => {
  it('applies the status factor and adds the bonus', () => {
    expect(earnedFor(D(600), 'PRESENT', D(0)).toString()).toBe('600');
    expect(earnedFor(D(600), 'HALF_DAY', D(100)).toString()).toBe('400');
    expect(earnedFor(D(600), 'ABSENT', D(0)).toString()).toBe('0');
    expect(earnedFor(D(600), 'PAID_LEAVE', D(0)).toString()).toBe('600');
  });

  it('is zero for an unmarked day', () => {
    expect(earnedFor(D(600), null, D(0)).toString()).toBe('0');
  });
});

describe('nextPayDate', () => {
  it('finds the next pay weekday after the period start', () => {
    // 2026-10-24 is a Saturday (6)
    const start = parseDate('2026-10-20');
    const d = nextPayDate(
      { payCycle: 'WEEKLY', payWeekday: 6, payMonthDay: null },
      start,
    );
    expect(formatDate(d!)).toBe('2026-10-24');
    const startingOnPayDay = nextPayDate(
      { payCycle: 'WEEKLY', payWeekday: 6, payMonthDay: null },
      parseDate('2026-10-24'),
    );
    expect(formatDate(startingOnPayDay!)).toBe('2026-10-31');
  });

  it('pays a monthly period that starts on the pay day next month', () => {
    const d = nextPayDate(
      { payCycle: 'MONTHLY', payWeekday: null, payMonthDay: 1 },
      parseDate('2026-10-01'),
    );
    expect(formatDate(d!)).toBe('2026-11-01');
  });

  it('finds the next monthly pay day, clamped to month length', () => {
    const d = nextPayDate(
      { payCycle: 'MONTHLY', payWeekday: null, payMonthDay: 31 },
      parseDate('2026-11-05'),
    );
    expect(formatDate(d!)).toBe('2026-11-30');
    const next = nextPayDate(
      { payCycle: 'MONTHLY', payWeekday: null, payMonthDay: 1 },
      parseDate('2026-12-02'),
    );
    expect(formatDate(next!)).toBe('2027-01-01');
  });

  it('returns null for manual pay', () => {
    expect(
      nextPayDate(
        { payCycle: 'MANUAL', payWeekday: null, payMonthDay: null },
        parseDate('2026-10-01'),
      ),
    ).toBeNull();
  });
});
