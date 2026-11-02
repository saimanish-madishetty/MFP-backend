import { parseDate } from '../common/dates.js';
import {
  financialYear,
  invoiceNumber,
  invoiceTotals,
  lineAmounts,
  sameState,
} from './invoice-math.js';

const intra = { pricesIncludeGst: false, interState: false };

describe('lineAmounts', () => {
  it('adds GST on top and splits CGST/SGST within the state', () => {
    const l = lineAmounts({ quantity: 10, rate: 45, gstRate: 5 }, intra);
    expect(l.taxableValue.toFixed(2)).toBe('450.00');
    expect(l.cgst.toFixed(2)).toBe('11.25');
    expect(l.sgst.toFixed(2)).toBe('11.25');
    expect(l.igst.toFixed(2)).toBe('0.00');
    expect(l.lineTotal.toFixed(2)).toBe('472.50');
  });

  it('uses IGST for another state', () => {
    const l = lineAmounts(
      { quantity: 10, rate: 45, gstRate: 5 },
      { pricesIncludeGst: false, interState: true },
    );
    expect(l.igst.toFixed(2)).toBe('22.50');
    expect(l.cgst.toFixed(2)).toBe('0.00');
  });

  it('takes GST out of prices that include it', () => {
    const l = lineAmounts(
      { quantity: 1, rate: 105, gstRate: 5 },
      { pricesIncludeGst: true, interState: false },
    );
    expect(l.taxableValue.toFixed(2)).toBe('100.00');
    expect(l.cgst.add(l.sgst).toFixed(2)).toBe('5.00');
    expect(l.lineTotal.toFixed(2)).toBe('105.00');
  });

  it('applies the discount before tax', () => {
    const l = lineAmounts(
      { quantity: 2, rate: 100, discount: 20, gstRate: 18 },
      intra,
    );
    expect(l.taxableValue.toFixed(2)).toBe('180.00');
    expect(l.lineTotal.toFixed(2)).toBe('212.40');
  });

  it('keeps CGST + SGST equal to the tax when it is an odd paisa', () => {
    const l = lineAmounts({ quantity: 1, rate: 10.1, gstRate: 5 }, intra);
    expect(l.cgst.add(l.sgst).toFixed(2)).toBe('0.51');
  });
});

describe('invoiceTotals', () => {
  it('rounds the grand total to the rupee', () => {
    const t = invoiceTotals([
      lineAmounts({ quantity: 10, rate: 45, gstRate: 5 }, intra),
      lineAmounts({ quantity: 3, rate: 33.33, gstRate: 0 }, intra),
    ]);
    // 472.50 + 99.99 = 572.49
    expect(t.grandTotal.toFixed(2)).toBe('572.00');
    expect(t.roundOff.toFixed(2)).toBe('-0.49');
  });
});

describe('financialYear', () => {
  it('starts in April', () => {
    expect(financialYear(parseDate('2026-03-31'))).toBe('2025-26');
    expect(financialYear(parseDate('2026-04-01'))).toBe('2026-27');
    expect(financialYear(parseDate('2099-12-01'))).toBe('2099-00');
  });

  it('formats invoice numbers', () => {
    expect(invoiceNumber('MF', '2026-27', 7)).toBe('MF/2026-27/0007');
  });
});

describe('sameState', () => {
  it('is case-insensitive and treats unknown as same', () => {
    expect(sameState('Karnataka', ' karnataka ')).toBe(true);
    expect(sameState('Karnataka', 'Kerala')).toBe(false);
    expect(sameState(null, 'Kerala')).toBe(true);
  });
});
