import { Unit } from '../generated/prisma/client.js';
import { stockUnit, unitFactor, type Packaging } from '../products/packaging.js';

/** Same wording as the app (src/lib/stock.ts unitShort in the frontend). */
const SHORT: Record<Unit, string> = {
  KG: 'kg',
  G: 'g',
  L: 'L',
  ML: 'ml',
  PCS: 'pcs',
  PACK: 'packs',
  BOX: 'boxes',
  CARTON: 'cartons',
  BAG: 'bags',
  ROLL: 'rolls',
  METER: 'm',
};

const QTY = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

/** "1,250.5 kg" */
export function formatQty(qty: number | string, unit: Unit): string {
  return `${QTY.format(Number(qty))} ${SHORT[unit]}`;
}

/** Stock for display: "4 packs + 3 pcs", "250 kg (10 bags)" or "12 boxes" (mirrors the app's formatStock). */
export function formatStock(p: Packaging, stockQty: number | string): string {
  const qty = Number(stockQty);
  const su = stockUnit(p);
  if (su === p.saleUnit) return formatQty(qty, p.saleUnit);
  const per = Number(unitFactor(p, p.saleUnit) ?? 1);
  if (su === Unit.PCS) {
    const sign = qty < 0 ? '−' : '';
    const abs = Math.abs(qty);
    const whole = Math.floor(abs / per + 1e-9);
    const rest = Math.round((abs - whole * per) * 1000) / 1000;
    if (whole === 0) return `${sign}${formatQty(rest, Unit.PCS)}`;
    return `${sign}${formatQty(whole, p.saleUnit)}${rest > 0 ? ` + ${formatQty(rest, Unit.PCS)}` : ''}`;
  }
  return `${formatQty(qty, su)} (${formatQty(qty / per, p.saleUnit)})`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 Nov" */
export const shortDay = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
