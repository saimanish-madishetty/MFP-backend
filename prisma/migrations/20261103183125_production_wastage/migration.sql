-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "expectedQty" DECIMAL(12,3),
ADD COLUMN     "productId" INTEGER;

-- CreateIndex
CREATE INDEX "StockMovement_productId_date_idx" ON "StockMovement"("productId", "date");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

