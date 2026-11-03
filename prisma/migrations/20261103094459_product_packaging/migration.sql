-- Product packaging: pieces per unit sold, price per (pack / piece / kg), per-piece recipe lines,
-- and sale lines that remember their unit's stock quantity and packaging description.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "piecesPerUnit" INTEGER,
ADD COLUMN     "priceUnit" "Unit";

-- AlterTable
ALTER TABLE "ProductMaterial" ADD COLUMN     "perPiece" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: existing lines were always in the product's own unit, so stock quantity = quantity.
ALTER TABLE "SaleLine" ADD COLUMN     "description" TEXT,
ADD COLUMN     "stockQty" DECIMAL(12,3);
UPDATE "SaleLine" SET "stockQty" = "quantity";
ALTER TABLE "SaleLine" ALTER COLUMN "stockQty" SET NOT NULL;
