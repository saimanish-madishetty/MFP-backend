// Business dates are plain calendar dates in IST, stored in Postgres `date` columns.
// In JS they are represented as Date objects at UTC midnight, and as "YYYY-MM-DD" in the API.

const IST_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's date in IST as UTC midnight. */
export function todayIST(): Date {
  return parseDate(IST_FORMAT.format(new Date()));
}

/** "YYYY-MM-DD" → Date at UTC midnight. */
export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date → "YYYY-MM-DD". */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}
