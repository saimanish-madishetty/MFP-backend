/**
 * Indian mobile number as 10 digits: drops spaces, dashes, a leading +91 / 91 / 0.
 * Returns null if it isn't a valid mobile number (10 digits starting 6-9).
 */
export function normalizePhone(input: string): string | null {
  let d = (input ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
