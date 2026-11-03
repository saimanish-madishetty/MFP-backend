-- Separate prices per unit sold (pack/bag) and per piece/kg, replacing the single price + priceUnit.

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "price" DROP NOT NULL,
ADD COLUMN     "piecePrice" DECIMAL(12,2);

-- A price that was set per piece/kg moves to piecePrice; the pack/bag price is then worked out from it.
UPDATE "Product" SET "piecePrice" = "price", "price" = NULL
WHERE "priceUnit" IS NOT NULL AND "priceUnit" <> "saleUnit";

ALTER TABLE "Product" DROP COLUMN "priceUnit";
