import { Prisma, ProductMovementType } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;

/**
 * Records a finished-goods movement and updates the product's running total in the same transaction.
 * Every change to finished stock goes through here (or `reverseProductMovement`).
 */
export async function applyProductMovement(
  tx: Tx,
  data: {
    productId: number;
    date: Date;
    type: ProductMovementType;
    quantity: Prisma.Decimal | number;
    note?: string;
    productionEntryId?: number;
    saleId?: number;
    batchId?: number;
  },
) {
  const movement = await tx.productStockMovement.create({ data });
  await tx.product.update({
    where: { id: data.productId },
    data: { currentQty: { increment: data.quantity } },
  });
  return movement;
}

export async function reverseProductMovement(
  tx: Tx,
  movement: { id: number; productId: number; quantity: Prisma.Decimal },
) {
  await tx.productStockMovement.delete({ where: { id: movement.id } });
  await tx.product.update({
    where: { id: movement.productId },
    data: { currentQty: { decrement: movement.quantity } },
  });
}
