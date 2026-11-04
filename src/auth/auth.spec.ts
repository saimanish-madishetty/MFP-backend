import { normalizePhone } from './phone.js';
import { hashPin, verifyPin } from './pin.js';
import { issueToken, readToken } from './token.js';

const SECRET = 'x'.repeat(40);

describe('normalizePhone', () => {
  it('accepts common ways of writing a mobile number', () => {
    for (const s of [
      '9876543210',
      '+91 98765 43210',
      '919876543210',
      '09876543210',
      '98765-43210',
    ])
      expect(normalizePhone(s)).toBe('9876543210');
  });
  it('rejects non-mobile numbers', () => {
    for (const s of ['', '12345', '5876543210', '98765432101', 'abc'])
      expect(normalizePhone(s)).toBeNull();
  });
});

describe('PIN hashing', () => {
  it('verifies the right PIN only', async () => {
    const h = await hashPin('1234');
    expect(h).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(await verifyPin('1234', h)).toBe(true);
    expect(await verifyPin('1235', h)).toBe(false);
    expect(await verifyPin('1234', 'garbage')).toBe(false);
  });
});

describe('login token', () => {
  it('round-trips and carries the user and version', () => {
    const t = issueToken(7, 3, SECRET);
    expect(readToken(t, SECRET)).toMatchObject({ sub: 7, v: 3 });
  });
  it('rejects a wrong secret, tampering and expiry', () => {
    const now = Date.now();
    const t = issueToken(7, 3, SECRET, now);
    expect(readToken(t, 'y'.repeat(40))).toBeNull();
    const [data, sig] = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 1, v: 3, exp: 9e9 }),
    ).toString('base64url');
    expect(readToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(readToken(`${data}.`, SECRET)).toBeNull();
    expect(readToken(t, SECRET, now + 31 * 86400 * 1000)).toBeNull();
  });
});
