import { describe, expect, it } from 'vitest';
import { Prisma, Unit } from '../generated/prisma/client.js';
import { formatQty, formatStock, shortDay } from './format.js';

const D = (n: number) => new Prisma.Decimal(n);
const noodles = { saleUnit: Unit.PACK, piecesPerUnit: 10, packSize: D(500), packUnit: Unit.G };
const bag = { saleUnit: Unit.BAG, piecesPerUnit: null, packSize: D(25), packUnit: Unit.KG };
const box = { saleUnit: Unit.BOX, piecesPerUnit: null, packSize: null, packUnit: null };

describe('widget formatting', () => {
  it('formats quantities like the app', () => {
    expect(formatQty(1250.5, Unit.KG)).toBe('1,250.5 kg');
    expect(formatQty('10', Unit.PACK)).toBe('10 packs');
  });

  it('formats stock in packs + pieces, kg (bags) or the sale unit', () => {
    expect(formatStock(noodles, 43)).toBe('4 packs + 3 pcs');
    expect(formatStock(noodles, 40)).toBe('4 packs');
    expect(formatStock(noodles, 7)).toBe('7 pcs');
    expect(formatStock(noodles, -12)).toBe('−1 packs + 2 pcs');
    expect(formatStock(bag, 250)).toBe('250 kg (10 bags)');
    expect(formatStock(box, 12)).toBe('12 boxes');
  });

  it('formats short dates', () => {
    expect(shortDay(new Date('2026-11-05T00:00:00Z'))).toBe('5 Nov');
  });
});
