-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'FINISHED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "batchPlanId" INTEGER;

-- AlterTable
ALTER TABLE "ProductStockMovement" ADD COLUMN     "batchId" INTEGER;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "batchAtFinish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "batchId" INTEGER;

-- CreateTable
CREATE TABLE "BatchPlan" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "planId" INTEGER NOT NULL,
    "stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage" INTEGER NOT NULL DEFAULT 0,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "materialsLost" BOOLEAN,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchStage" (
    "id" SERIAL NOT NULL,
    "batchId" INTEGER NOT NULL,
    "stage" INTEGER NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "BatchStage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BatchPlan_name_key" ON "BatchPlan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_number_key" ON "Batch"("number");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "Batch_startDate_idx" ON "Batch"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "BatchStage_batchId_stage_key" ON "BatchStage"("batchId", "stage");

-- CreateIndex
CREATE INDEX "ProductStockMovement_batchId_idx" ON "ProductStockMovement"("batchId");

-- CreateIndex
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_batchPlanId_fkey" FOREIGN KEY ("batchPlanId") REFERENCES "BatchPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BatchPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchStage" ADD CONSTRAINT "BatchStage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
