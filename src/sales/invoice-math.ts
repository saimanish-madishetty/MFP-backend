import { Prisma } from '../generated/prisma/client.js';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
type Num = Decimal | number | string;
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export type LineInput = {
  quantity: Num;
  rate: Num;
  discount?: Num;
  /** Percent; 0 when not taxed */
  gstRate: Num;
};

export type LineAmounts = {
  gross: Decimal;
  discount: Decimal;
  taxableValue: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  lineTotal: Decimal;
};

/**
 * One invoice line.
 * - Prices excluding GST: taxable = qty × rate − discount, tax added on top.
 * - Prices including GST: the tax is taken out of (qty × rate − discount).
 * - Same state: tax split equally into CGST and SGST; other state: all IGST.
 */
export function lineAmounts(
  line: LineInput,
  opts: { pricesIncludeGst: boolean; interState: boolean },
): LineAmounts {
  const gross = r2(new Decimal(line.quantity).mul(line.rate));
  const discount = r2(new Decimal(line.discount ?? 0));
  const net = gross.sub(discount);
  const rate = new Decimal(line.gstRate);

  let taxableValue: Decimal;
  let tax: Decimal;
  if (opts.pricesIncludeGst && rate.gt(0)) {
    taxableValue = r2(net.div(rate.div(100).add(1)));
    tax = net.sub(taxableValue);
  } else {
    taxableValue = net;
    tax = r2(net.mul(rate).div(100));
  }

  const zero = new Decimal(0);
  const cgst = opts.interState ? zero : r2(tax.div(2));
  const sgst = opts.interState ? zero : tax.sub(cgst);
  const igst = opts.interState ? tax : zero;
  return {
    gross,
    discount,
    taxableValue,
    cgst,
    sgst,
    igst,
    lineTotal: taxableValue.add(tax),
  };
}

export function invoiceTotals(lines: LineAmounts[]) {
  const sum = (pick: (l: LineAmounts) => Decimal) =>
    lines.reduce((acc, l) => acc.add(pick(l)), new Decimal(0));
  const exact = sum((l) => l.lineTotal);
  const grandTotal = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    subtotal: sum((l) => l.gross),
    discountTotal: sum((l) => l.discount),
    taxableTotal: sum((l) => l.taxableValue),
    cgstTotal: sum((l) => l.cgst),
    sgstTotal: sum((l) => l.sgst),
    igstTotal: sum((l) => l.igst),
    roundOff: grandTotal.sub(exact),
    grandTotal,
  };
}

/** Indian financial year (April–March) of a date, e.g. "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function invoiceNumber(prefix: string, fy: string, sequence: number) {
  return `${prefix}/${fy}/${String(sequence).padStart(4, '0')}`;
}

export function sameState(a?: string | null, b?: string | null) {
  if (!a || !b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
