import { Prisma, Unit } from '../generated/prisma/client.js';

const Decimal = Prisma.Decimal;
type Dec = Prisma.Decimal;

/**
 * How a product is packed, e.g.
 *   noodles:    saleUnit PACK, piecesPerUnit 10, packSize 500 G  → "10 × 500 g pack (5 kg)"
 *   vermicelli: saleUnit BAG,  piecesPerUnit null, packSize 25 KG → "25 kg bag"
 *
 * Stock is kept in the smallest unit that can be sold, so loose pieces or kilos can be sold too:
 *   pieces (PCS) when the product has pieces, else KG/L when it has a weight/volume, else the sale unit.
 * A product can be sold in its sale unit or in its stock unit.
 */
export type Packaging = {
  saleUnit: Unit;
  piecesPerUnit: number | null;
  packSize: Dec | null;
  packUnit: Unit | null;
  priceUnit?: Unit | null;
};

const BASE: Partial<Record<Unit, { base: Unit; per: number }>> = {
  [Unit.G]: { base: Unit.KG, per: 1000 },
  [Unit.KG]: { base: Unit.KG, per: 1 },
  [Unit.ML]: { base: Unit.L, per: 1000 },
  [Unit.L]: { base: Unit.L, per: 1 },
};

const SHORT: Partial<Record<Unit, string>> = {
  [Unit.KG]: 'kg',
  [Unit.G]: 'g',
  [Unit.L]: 'L',
  [Unit.ML]: 'ml',
  [Unit.PCS]: 'pcs',
};
const unitName = (u: Unit) => SHORT[u] ?? u.toLowerCase();

/** For messages: "pack", "piece", "kg". */
export const unitLabel = (u: Unit) => (u === Unit.PCS ? 'piece' : unitName(u));

/** For messages: "pack or piece". */
export const unitsLabel = (units: Unit[], joiner = 'or') =>
  units.map(unitLabel).join(` ${joiner} `);

const hasPieces = (p: Packaging) => (p.piecesPerUnit ?? 0) > 1;

/** Unit that stock, production and sales are counted in internally. */
export function stockUnit(p: Packaging): Unit {
  if (hasPieces(p)) return Unit.PCS;
  if (p.packSize && p.packUnit && BASE[p.packUnit])
    return BASE[p.packUnit]!.base;
  return p.saleUnit;
}

/** Stock units in one `unit`, or null if the product can't be counted in that unit. */
export function unitFactor(p: Packaging, unit: Unit): Dec | null {
  const stock = stockUnit(p);
  if (unit === stock) return new Decimal(1);
  if (unit !== p.saleUnit) return null;
  if (hasPieces(p)) return new Decimal(p.piecesPerUnit!);
  const base = p.packUnit ? BASE[p.packUnit] : undefined;
  return new Decimal(p.packSize!).div(base!.per);
}

/** Units a product can be sold / counted in: the sale unit, plus pieces or kg/L when they differ. */
export function sellUnits(p: Packaging): Unit[] {
  return [...new Set([p.saleUnit, stockUnit(p)])];
}

/** Converts a quantity in `unit` to stock units; throws if the unit doesn't apply. */
export function toStock(p: Packaging, qty: Dec | number, unit: Unit): Dec {
  const factor = unitFactor(p, unit);
  if (!factor) throw new Error(`Unit ${unit} does not apply to this product`);
  return new Decimal(qty).mul(factor);
}

/** Converts stock units to the sale unit (e.g. pieces → packs). */
export function toSaleUnits(p: Packaging, stockQty: Dec | number): Dec {
  return new Decimal(stockQty).div(unitFactor(p, p.saleUnit)!);
}

/** Price per unit sold (the product's price may be per piece or per kg). */
export function pricePerSaleUnit(p: Packaging, price: Dec): Dec {
  const priceUnit = p.priceUnit ?? p.saleUnit;
  const factor = unitFactor(p, priceUnit) ?? new Decimal(1);
  return price.mul(unitFactor(p, p.saleUnit)!).div(factor);
}

/** "10 × 500 g pack (5 kg)", "25 kg bag", "pack". */
export function packDescription(p: Packaging): string {
  const sale = unitName(p.saleUnit);
  if (!p.packSize || !p.packUnit) {
    return hasPieces(p) ? `${p.piecesPerUnit} pcs ${sale}` : sale;
  }
  const size = `${new Decimal(p.packSize).toString()} ${unitName(p.packUnit)}`;
  if (!hasPieces(p)) return `${size} ${sale}`;
  const base = BASE[p.packUnit];
  const total = base
    ? ` (${new Decimal(p.packSize).mul(p.piecesPerUnit!).div(base.per).toString()} ${unitName(base.base)})`
    : '';
  return `${p.piecesPerUnit} × ${size} ${sale}${total}`;
}

/** Everything the app needs to show and convert a product's quantities. */
export function packagingInfo(p: Packaging) {
  return {
    stockUnit: stockUnit(p),
    description: packDescription(p),
    units: sellUnits(p).map((unit) => ({
      unit,
      factor: unitFactor(p, unit)!.toString(),
    })),
  };
}
