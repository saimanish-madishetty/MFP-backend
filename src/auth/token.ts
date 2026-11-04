import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Login token: base64url(JSON payload) + "." + HMAC-SHA256 signature with AUTH_SECRET.
 * `v` is the user's tokenVersion, so resetting a PIN or disabling a user ends old logins.
 */
export type TokenPayload = { sub: number; v: number; exp: number };

export const TOKEN_DAYS = 30;

function sign(data: string, secret: string) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function issueToken(
  userId: number,
  version: number,
  secret: string,
  now = Date.now(),
): string {
  const payload: TokenPayload = {
    sub: userId,
    v: version,
    exp: Math.floor(now / 1000) + TOKEN_DAYS * 86400,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, secret)}`;
}

/** The payload if the signature is right and it hasn't expired; otherwise null. */
export function readToken(
  token: string,
  secret: string,
  now = Date.now(),
): TokenPayload | null {
  const [data, sig] = (token ?? '').split('.');
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const p = JSON.parse(
      Buffer.from(data, 'base64url').toString(),
    ) as TokenPayload;
    if (
      typeof p.sub !== 'number' ||
      typeof p.v !== 'number' ||
      typeof p.exp !== 'number'
    )
      return null;
    return p.exp * 1000 > now ? p : null;
  } catch {
    return null;
  }
}
