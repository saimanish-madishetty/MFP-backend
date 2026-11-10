-- AlterTable
ALTER TABLE "ProductStockMovement" ADD COLUMN     "batchPackingId" INTEGER;

-- AlterTable
ALTER TABLE "StockMovement" DROP COLUMN "batchAtFinish",
ADD COLUMN     "batchPackingId" INTEGER;

-- CreateTable
CREATE TABLE "BatchPacking" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchPacking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchPacking_batchId_idx" ON "BatchPacking"("batchId");

-- CreateIndex
CREATE INDEX "BatchPacking_date_idx" ON "BatchPacking"("date");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchPackingId_fkey" FOREIGN KEY ("batchPackingId") REFERENCES "BatchPacking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_batchPackingId_fkey" FOREIGN KEY ("batchPackingId") REFERENCES "BatchPacking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchPacking" ADD CONSTRAINT "BatchPacking_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

