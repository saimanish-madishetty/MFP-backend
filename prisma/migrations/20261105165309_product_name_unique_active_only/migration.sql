-- DropIndex
DROP INDEX "Product_internalName_key";

-- CreateIndex
CREATE INDEX "Product_internalName_idx" ON "Product"("internalName");

