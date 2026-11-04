// Creates an admin who can log in to the app, or, if the number already has an account,
// makes it an active admin with the new PIN (recovery if every admin is locked out).
// After that, admins add everyone else from the app (Users page).
//
//   npm run create-admin -- 9876543210 "Sai Manish" 1234          local database (.env)
//   npm run create-admin -- 9876543210 "Sai Manish" 1234 --prod   production (Supabase)
//
// --prod reads DATABASE_URL from %USERPROFILE%\.mfp-secrets\supabase.env. Run from MFP-backend
// (the connection string points at certs/ for TLS verification).
import { randomBytes, scrypt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const args = process.argv.slice(2);
const prod = args.includes('--prod');
const [phoneArg, name, pin] = args.filter((a) => a !== '--prod');

function fail(msg) {
  console.error(`create-admin: ${msg}`);
  process.exit(1);
}

if (!phoneArg || !name || !pin)
  fail('usage: npm run create-admin -- <mobile> "<name>" <pin> [--prod]');

// Same rules as src/auth/phone.ts and the PIN check in src/auth/dto/auth.dto.ts.
let phone = phoneArg.replace(/\D/g, '');
if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
else if (phone.length === 11 && phone.startsWith('0')) phone = phone.slice(1);
if (!/^[6-9]\d{9}$/.test(phone)) fail('mobile number must be 10 digits starting 6-9');
if (!/^\d{4,6}$/.test(pin)) fail('PIN must be 4 to 6 digits');

/** Same format as hashPin() in src/auth/pin.ts: keep the two in step. */
async function hashPin(value) {
  const salt = randomBytes(16);
  const hash = await promisify(scrypt)(value, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

let url;
if (prod) {
  const file = join(homedir(), '.mfp-secrets', 'supabase.env');
  if (!existsSync(file)) fail(`${file} not found`);
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  url = line?.slice('DATABASE_URL='.length).trim();
} else {
  if (existsSync('.env')) process.loadEnvFile('.env');
  url = process.env.DATABASE_URL;
}
if (!url) fail('DATABASE_URL not found');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const pinHash = await hashPin(pin);
  const { rows } = await client.query(
    `INSERT INTO "User" (name, phone, "pinHash", role, active, "updatedAt")
     VALUES ($1, $2, $3, 'ADMIN', true, now())
     ON CONFLICT (phone) DO UPDATE SET
       name = EXCLUDED.name, "pinHash" = EXCLUDED."pinHash", role = 'ADMIN', active = true,
       "failedLogins" = 0, "lockedUntil" = NULL, "tokenVersion" = "User"."tokenVersion" + 1,
       "updatedAt" = now()
     RETURNING id, (xmax = 0) AS created`,
    [name.trim(), phone, pinHash],
  );
  const { id, created } = rows[0];
  console.log(
    `${created ? 'Created' : 'Updated'} admin #${id}: ${name.trim()} (${phone}) on the ${prod ? 'PRODUCTION' : 'local'} database. Log in with this number and PIN.`,
  );
} finally {
  await client.end();
}
