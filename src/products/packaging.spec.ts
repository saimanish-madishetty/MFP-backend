import { describe, expect, it } from 'vitest';
import { Prisma, Unit } from '../generated/prisma/client.js';
import {
  packDescription,
  pricePerSaleUnit,
  sellUnits,
  stockUnit,
  toSaleUnits,
  toStock,
  unitFactor,
  type Packaging,
} from './packaging.js';

const D = (n: number | string) => new Prisma.Decimal(n);

const noodles: Packaging = {
  saleUnit: Unit.PACK,
  piecesPerUnit: 10,
  packSize: D(500),
  packUnit: Unit.G,
};
const vermicelli: Packaging = {
  saleUnit: Unit.BAG,
  piecesPerUnit: null,
  packSize: D(25),
  packUnit: Unit.KG,
  priceUnit: Unit.KG,
};
const plain: Packaging = {
  saleUnit: Unit.BOX,
  piecesPerUnit: null,
  packSize: null,
  packUnit: null,
};

describe('packaging', () => {
  it('keeps pieced products in pieces, sold by pack or piece', () => {
    expect(stockUnit(noodles)).toBe(Unit.PCS);
    expect(sellUnits(noodles)).toEqual([Unit.PACK, Unit.PCS]);
    expect(toStock(noodles, 4, Unit.PACK).toString()).toBe('40');
    expect(toStock(noodles, 3, Unit.PCS).toString()).toBe('3');
    expect(toSaleUnits(noodles, 43).toString()).toBe('4.3');
  });

  it('keeps weighed products in kg, sold by bag or kg', () => {
    expect(stockUnit(vermicelli)).toBe(Unit.KG);
    expect(sellUnits(vermicelli)).toEqual([Unit.BAG, Unit.KG]);
    expect(toStock(vermicelli, 2, Unit.BAG).toString()).toBe('50');
    expect(toStock(vermicelli, 12.5, Unit.KG).toString()).toBe('12.5');
  });

  it('converts gram sizes to kg', () => {
    const pouch = {
      ...plain,
      saleUnit: Unit.PACK,
      packSize: D(500),
      packUnit: Unit.G,
    };
    expect(stockUnit(pouch)).toBe(Unit.KG);
    expect(unitFactor(pouch, Unit.PACK)?.toString()).toBe('0.5');
  });

  it('keeps products without size in their own unit', () => {
    expect(stockUnit(plain)).toBe(Unit.BOX);
    expect(sellUnits(plain)).toEqual([Unit.BOX]);
    expect(unitFactor(plain, Unit.KG)).toBeNull();
    expect(() => toStock(plain, 1, Unit.KG)).toThrow();
  });

  it('works out the price per unit sold', () => {
    // ₹40/kg × 25 kg = ₹1000 per bag
    expect(pricePerSaleUnit(vermicelli, D(40)).toString()).toBe('1000');
    // price per pack stays as is
    expect(pricePerSaleUnit(noodles, D(450)).toString()).toBe('450');
    // ₹50 per piece × 10 = ₹500 per pack
    expect(
      pricePerSaleUnit({ ...noodles, priceUnit: Unit.PCS }, D(50)).toString(),
    ).toBe('500');
  });

  it('describes the packing', () => {
    expect(packDescription(noodles)).toBe('10 × 500 g pack (5 kg)');
    expect(packDescription(vermicelli)).toBe('25 kg bag');
    expect(packDescription(plain)).toBe('box');
    expect(packDescription({ ...plain, piecesPerUnit: 24 })).toBe('24 pcs box');
  });
});
