import { Prisma } from '../generated/prisma/client.js';
import { toSaleUnits } from './packaging.js';

export const recipeInclude = {
  materials: true,
} satisfies Prisma.ProductInclude;

export type ProductWithRecipe = Prisma.ProductGetPayload<{
  include: typeof recipeInclude;
}>;

/**
 * How much of a material the recipe says `made` (in sale units) should take, or null when the
 * material isn't in the recipe or its quantity isn't filled in.
 */
export function expectedUse(
  product: ProductWithRecipe,
  materialId: number,
  made: Prisma.Decimal | number,
): Prisma.Decimal | null {
  const line = product.materials.find((m) => m.materialId === materialId);
  if (!line?.qtyPerUnit) return null;
  const perUnit = line.perPiece
    ? line.qtyPerUnit.mul(product.piecesPerUnit ?? 1)
    : line.qtyPerUnit;
  return perUnit.mul(made).toDecimalPlaces(3);
}

/**
 * A batch's materials compared with what its recipes say the products made should have taken.
 * Materials go into a batch as a whole (the packs are chosen at the end), so each material's use is
 * shared out between the products made in proportion to what their recipes expect. A material no
 * product's recipe lists gets `expected: null` and no shares.
 */
export function batchShares(
  outputs: { product: ProductWithRecipe; quantity: Prisma.Decimal }[],
  used: Map<number, Prisma.Decimal>,
) {
  return [...used].map(([materialId, total]) => {
    const parts = outputs
      .map((o) => ({
        productId: o.product.id,
        expected: expectedUse(
          o.product,
          materialId,
          toSaleUnits(o.product, o.quantity),
        ),
      }))
      .filter(
        (x): x is { productId: number; expected: Prisma.Decimal } =>
          x.expected !== null,
      );
    const expected = parts.reduce(
      (t, x) => t.add(x.expected),
      new Prisma.Decimal(0),
    );
    return {
      materialId,
      used: total,
      expected: parts.length > 0 ? expected : null,
      shares: parts.map((x) => ({
        productId: x.productId,
        expected: x.expected,
        used: (expected.gt(0)
          ? total.mul(x.expected).div(expected)
          : new Prisma.Decimal(0)
        ).toDecimalPlaces(3),
      })),
    };
  });
}
