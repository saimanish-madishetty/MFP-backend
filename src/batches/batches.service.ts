import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BatchStatus,
  MaterialType,
  Prisma,
  ProductMovementType,
  StockMovementType,
} from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  applyProductMovement,
  reverseProductMovement,
} from '../products/product-stock.js';
import { toSaleUnits } from '../products/packaging.js';
import { batchShares, recipeInclude } from '../products/recipe.js';
import { applyMovement, reverseMovement } from '../stock/stock.service.js';
import {
  BatchMaterialDto,
  CancelBatchDto,
  CreateBatchPlanDto,
  FinishBatchDto,
  StartBatchDto,
  UpdateBatchDto,
  UpdateBatchPlanDto,
} from './dto/batch.dto.js';

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

const batchInclude = {
  plan: { select: { id: true, name: true } },
  stageDates: { orderBy: { stage: 'asc' } },
  materialMovements: {
    orderBy: { id: 'asc' },
    include: {
      material: {
        select: {
          id: true,
          name: true,
          type: true,
          unit: true,
          lastCostPerUnit: true,
        },
      },
    },
  },
  productMovements: {
    orderBy: { id: 'asc' },
    include: { product: { include: recipeInclude } },
  },
} satisfies Prisma.BatchInclude;

type BatchFull = Prisma.BatchGetPayload<{ include: typeof batchInclude }>;

const cleanStages = (stages: string[]) => stages.map((s) => s.trim());

function assertNotFuture(date: Date) {
  if (date > todayIST())
    throw new BadRequestException('Date cannot be in the future');
}

/** "B-101126-" for 10 Nov 2026: the start date as DDMMYY. */
function numberPrefix(date: Date) {
  const [y, m, d] = formatDate(date).split('-');
  return `B-${d}${m}${y.slice(2)}-`;
}

/**
 * Batches: production that takes more than one day. A batch follows a batch plan (its stages).
 * Starting it takes the raw materials out of stock; each stage reached is dated; finishing it adds
 * the products made (the packs are chosen then) and takes the packing supplies. Cancelling it either
 * keeps the materials as used (lost) or puts them back.
 */
@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Batch plans ────────────────────────────────────────────

  async plans() {
    const plans = await this.prisma.batchPlan.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: {
        products: { select: { id: true }, orderBy: { id: 'asc' } },
        _count: { select: { batches: { where: { status: BatchStatus.OPEN } } } },
        // The latest batch's materials: a new batch starts with the same list.
        batches: {
          orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            materialMovements: {
              where: { batchAtFinish: false },
              select: { materialId: true },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    return plans.map(({ products, _count, batches, ...p }) => ({
      ...p,
      productIds: products.map((x) => x.id),
      openBatches: _count.batches,
      lastMaterialIds:
        batches[0]?.materialMovements.map((m) => m.materialId) ?? [],
    }));
  }

  async createPlan(dto: CreateBatchPlanDto) {
    await this.assertPlanNameFree(dto.name);
    const plan = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.batchPlan.create({
        data: { name: dto.name.trim(), stages: cleanStages(dto.stages) },
      });
      if (dto.productIds) await this.setPlanProducts(tx, plan.id, dto.productIds);
      return plan;
    });
    return this.plan(plan.id);
  }

  async updatePlan(id: number, dto: UpdateBatchPlanDto) {
    await this.planOrThrow(id);
    if (dto.name !== undefined) await this.assertPlanNameFree(dto.name, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.batchPlan.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          stages: dto.stages && cleanStages(dto.stages),
          active: dto.active,
        },
      });
      if (dto.productIds) await this.setPlanProducts(tx, id, dto.productIds);
    });
    return this.plan(id);
  }

  /** Only a plan with no batches can be deleted; archive the others. */
  async removePlan(id: number) {
    await this.planOrThrow(id);
    const batches = await this.prisma.batch.count({ where: { planId: id } });
    if (batches > 0)
      throw new BadRequestException(
        `This plan has ${batches} batch${batches === 1 ? '' : 'es'}, so it can't be deleted. Archive it instead.`,
      );
    await this.prisma.batchPlan.delete({ where: { id } });
  }

  private async plan(id: number) {
    return (await this.plans()).find((p) => p.id === id)!;
  }

  private async planOrThrow(id: number) {
    const plan = await this.prisma.batchPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Batch plan not found');
    return plan;
  }

  private async assertPlanNameFree(name: string, exceptId?: number) {
    const existing = await this.prisma.batchPlan.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
    });
    if (existing)
      throw new ConflictException(
        `A batch plan named "${existing.name}" already exists`,
      );
  }

  private async setPlanProducts(tx: Tx, planId: number, productIds: number[]) {
    const found = await tx.product.count({ where: { id: { in: productIds } } });
    if (found !== new Set(productIds).size)
      throw new BadRequestException('Unknown product in the list');
    await tx.product.updateMany({
      where: { batchPlanId: planId, id: { notIn: productIds } },
      data: { batchPlanId: null },
    });
    await tx.product.updateMany({
      where: { id: { in: productIds } },
      data: { batchPlanId: planId },
    });
  }

  // ── Batches ────────────────────────────────────────────────

  /** Open batches (oldest first), or finished / cancelled ones (latest first, up to 100). */
  async list(status?: BatchStatus) {
    const batches = await this.prisma.batch.findMany({
      where: status ? { status } : undefined,
      orderBy:
        status === BatchStatus.OPEN
          ? [{ startDate: 'asc' }, { id: 'asc' }]
          : [{ endDate: 'desc' }, { startDate: 'desc' }, { id: 'desc' }],
      take: status === BatchStatus.OPEN ? undefined : 100,
      include: {
        plan: { select: { id: true, name: true } },
        stageDates: { orderBy: { stage: 'desc' }, take: 1 },
        productMovements: {
          select: { productId: true, quantity: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    return batches.map((b) => ({
      id: b.id,
      number: b.number,
      status: b.status,
      plan: b.plan,
      stages: b.stages,
      stage: b.stage,
      startDate: formatDate(b.startDate),
      endDate: b.endDate && formatDate(b.endDate),
      /** When the current stage was reached */
      stageDate: b.stageDates[0]
        ? formatDate(b.stageDates[0].date)
        : formatDate(b.startDate),
      materialsLost: b.materialsLost,
      products: b.productMovements.map((m) => ({
        productId: m.productId,
        stockQty: m.quantity.toString(),
      })),
    }));
  }

  async get(id: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: batchInclude,
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return this.detail(batch);
  }

  async start(dto: StartBatchDto) {
    const plan = await this.planOrThrow(dto.planId);
    if (!plan.active)
      throw new BadRequestException('This batch plan is archived');
    if (plan.stages.length === 0)
      throw new BadRequestException('Add the stages to the batch plan first');
    const date = parseDate(dto.date);
    assertNotFuture(date);
    await this.assertMaterials(dto.materials);

    const id = await this.prisma.$transaction(async (tx) => {
      const prefix = numberPrefix(date);
      const sameDay = await tx.batch.count({
        where: { number: { startsWith: prefix } },
      });
      const number = `${prefix}${sameDay + 1}`;
      const batch = await tx.batch.create({
        data: {
          number,
          planId: plan.id,
          stages: plan.stages,
          startDate: date,
          notes: dto.notes?.trim() || null,
          stageDates: { create: { stage: 0, date } },
        },
      });
      await this.useMaterials(tx, batch.id, number, date, dto.materials, false);
      return batch.id;
    });
    return this.get(id);
  }

  /** While a batch is open: change its start date, its raw materials or its notes. */
  async update(id: number, dto: UpdateBatchDto) {
    const batch = await this.openOrThrow(id);
    const date = dto.date ? parseDate(dto.date) : batch.startDate;
    assertNotFuture(date);
    const later = batch.stageDates.filter((s) => s.stage > 0);
    if (later.some((s) => s.date < date))
      throw new BadRequestException(
        'The start date must be on or before the dates of the later stages',
      );
    if (dto.materials) await this.assertMaterials(dto.materials);

    await this.prisma.$transaction(async (tx) => {
      await tx.batch.update({
        where: { id },
        data: {
          startDate: date,
          ...(dto.notes !== undefined && { notes: dto.notes.trim() || null }),
        },
      });
      await tx.batchStage.updateMany({
        where: { batchId: id, stage: 0 },
        data: { date },
      });
      if (dto.materials) {
        for (const m of batch.materialMovements) await reverseMovement(tx, m);
        await this.useMaterials(tx, id, batch.number, date, dto.materials, false);
      } else {
        await tx.stockMovement.updateMany({
          where: { batchId: id },
          data: { date },
        });
      }
    });
    return this.get(id);
  }

  /** Moves the batch to its next stage, reached on `date`. */
  async nextStage(id: number, dateStr: string) {
    const batch = await this.openOrThrow(id);
    if (batch.stage + 1 >= batch.stages.length)
      throw new BadRequestException(
        'This is the last stage: finish the batch to enter what was made',
      );
    const date = parseDate(dateStr);
    assertNotFuture(date);
    this.assertAfterStages(batch, date);
    await this.prisma.$transaction([
      this.prisma.batchStage.create({
        data: { batchId: id, stage: batch.stage + 1, date },
      }),
      this.prisma.batch.update({
        where: { id },
        data: { stage: batch.stage + 1 },
      }),
    ]);
    return this.get(id);
  }

  /** Takes the batch back to its previous stage (a stage marked by mistake). */
  async undoStage(id: number) {
    const batch = await this.openOrThrow(id);
    if (batch.stage === 0)
      throw new BadRequestException('The batch is at its first stage');
    await this.prisma.$transaction([
      this.prisma.batchStage.deleteMany({
        where: { batchId: id, stage: batch.stage },
      }),
      this.prisma.batch.update({
        where: { id },
        data: { stage: batch.stage - 1 },
      }),
    ]);
    return this.get(id);
  }

  /** What was made (added to finished stock) and the packing supplies used: the batch is done. */
  async finish(id: number, dto: FinishBatchDto) {
    const batch = await this.openOrThrow(id);
    const date = parseDate(dto.date);
    assertNotFuture(date);
    this.assertAfterStages(batch, date);
    await this.assertMaterials(dto.supplies);
    const found = await this.prisma.product.count({
      where: { id: { in: dto.products.map((p) => p.productId) } },
    });
    if (found !== dto.products.length)
      throw new BadRequestException('Unknown product in the list');

    await this.prisma.$transaction(async (tx) => {
      for (const p of dto.products)
        await applyProductMovement(tx, {
          productId: p.productId,
          date,
          type: ProductMovementType.PRODUCED,
          quantity: p.stockQty,
          note: `Batch ${batch.number}`,
          batchId: id,
        });
      await this.useMaterials(tx, id, batch.number, date, dto.supplies, true);
      await tx.batch.update({
        where: { id },
        data: {
          status: BatchStatus.FINISHED,
          endDate: date,
          ...(dto.notes !== undefined && { notes: dto.notes.trim() || null }),
        },
      });
    });
    return this.get(id);
  }

  /** Undoes finishing: the products and supplies are taken back out, and the batch is open again. */
  async reopen(id: number) {
    const batch = await this.batchOrThrow(id);
    if (batch.status !== BatchStatus.FINISHED)
      throw new BadRequestException('Only a finished batch can be reopened');
    await this.prisma.$transaction(async (tx) => {
      for (const m of batch.productMovements)
        await reverseProductMovement(tx, m);
      for (const m of batch.materialMovements.filter((x) => x.batchAtFinish))
        await reverseMovement(tx, m);
      await tx.batch.update({
        where: { id },
        data: { status: BatchStatus.OPEN, endDate: null },
      });
    });
    return this.get(id);
  }

  async cancel(id: number, dto: CancelBatchDto) {
    const batch = await this.openOrThrow(id);
    const date = parseDate(dto.date);
    assertNotFuture(date);
    if (date < batch.startDate)
      throw new BadRequestException('The date is before the batch started');
    await this.prisma.$transaction(async (tx) => {
      if (!dto.materialsLost)
        for (const m of batch.materialMovements) await reverseMovement(tx, m);
      const reason = dto.reason?.trim();
      await tx.batch.update({
        where: { id },
        data: {
          status: BatchStatus.CANCELLED,
          endDate: date,
          materialsLost: dto.materialsLost,
          ...(reason && {
            notes: [batch.notes, `Cancelled: ${reason}`]
              .filter(Boolean)
              .join('\n'),
          }),
        },
      });
    });
    return this.get(id);
  }

  // ── Helpers ────────────────────────────────────────────────

  private async batchOrThrow(id: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { stageDates: true, materialMovements: true, productMovements: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  private async openOrThrow(id: number) {
    const batch = await this.batchOrThrow(id);
    if (batch.status !== BatchStatus.OPEN)
      throw new BadRequestException(
        batch.status === BatchStatus.FINISHED
          ? 'This batch is finished'
          : 'This batch was cancelled',
      );
    return batch;
  }

  private assertAfterStages(
    batch: { stageDates: { date: Date }[] },
    date: Date,
  ) {
    const last = batch.stageDates.reduce(
      (max, s) => (s.date > max ? s.date : max),
      new Date(0),
    );
    if (date < last)
      throw new BadRequestException(
        `The date can't be before the last stage (${formatDate(last)})`,
      );
  }

  private async assertMaterials(materials: BatchMaterialDto[]) {
    if (materials.length === 0) return;
    const found = await this.prisma.material.count({
      where: { id: { in: materials.map((m) => m.materialId) } },
    });
    if (found !== materials.length)
      throw new BadRequestException('Unknown material in the list');
  }

  private async useMaterials(
    tx: Tx,
    batchId: number,
    number: string,
    date: Date,
    materials: BatchMaterialDto[],
    atFinish: boolean,
  ) {
    for (const m of materials)
      await applyMovement(tx, {
        materialId: m.materialId,
        date,
        type: StockMovementType.USAGE,
        quantity: -m.quantity,
        note: `Batch ${number}`,
        batchId,
        batchAtFinish: atFinish,
      });
  }

  /** The batch as the screens show it, with wastage and material cost once it is finished. */
  private detail(b: BatchFull) {
    const stageDate = new Map(b.stageDates.map((s) => [s.stage, s.date]));
    const used = new Map<number, Prisma.Decimal>();
    for (const m of b.materialMovements)
      used.set(
        m.materialId,
        (used.get(m.materialId) ?? new Decimal(0)).add(m.quantity.neg()),
      );
    const materialById = new Map(
      b.materialMovements.map((m) => [m.materialId, m.material]),
    );

    // Cost of everything used, at each material's latest price (an estimate).
    let cost = new Decimal(0);
    let costIncomplete = false;
    for (const [id, qty] of used) {
      const price = materialById.get(id)?.lastCostPerUnit;
      if (price) cost = cost.add(qty.mul(price));
      else costIncomplete = true;
    }

    const finished = b.status === BatchStatus.FINISHED;
    const wastage = finished
      ? batchShares(
          b.productMovements.map((m) => ({
            product: m.product,
            quantity: m.quantity,
          })),
          used,
        ).map((w) => {
          const material = materialById.get(w.materialId)!;
          const waste = w.expected ? w.used.sub(w.expected) : null;
          return {
            material: {
              id: material.id,
              name: material.name,
              type: material.type,
              unit: material.unit,
            },
            used: w.used.toString(),
            expected: w.expected?.toString() ?? null,
            waste: waste?.toString() ?? null,
            wastePct:
              waste && w.expected?.gt(0)
                ? waste.div(w.expected).mul(100).toDecimalPlaces(1).toString()
                : null,
            value:
              waste && material.lastCostPerUnit
                ? waste.mul(material.lastCostPerUnit).toDecimalPlaces(2).toString()
                : null,
          };
        })
      : [];

    return {
      id: b.id,
      number: b.number,
      status: b.status,
      plan: b.plan,
      stage: b.stage,
      stages: b.stages.map((name, i) => ({
        name,
        date: stageDate.has(i) ? formatDate(stageDate.get(i)!) : null,
      })),
      startDate: formatDate(b.startDate),
      endDate: b.endDate && formatDate(b.endDate),
      materialsLost: b.materialsLost,
      notes: b.notes,
      /** Raw materials put in at the start (`atFinish` false) and supplies used when finishing */
      materials: b.materialMovements.map((m) => ({
        materialId: m.materialId,
        name: m.material.name,
        type: m.material.type as MaterialType,
        unit: m.material.unit,
        quantity: m.quantity.neg().toString(),
        atFinish: m.batchAtFinish,
      })),
      /** Made: `quantity` in sale units, `stockQty` in stock units */
      products: b.productMovements.map((m) => ({
        productId: m.productId,
        quantity: toSaleUnits(m.product, m.quantity).toString(),
        stockQty: m.quantity.toString(),
      })),
      wastage,
      /** ₹ at the materials' latest prices; `incomplete` when one has no price */
      cost: {
        materials: cost.toDecimalPlaces(2).toString(),
        incomplete: costIncomplete,
        waste: wastage
          .reduce((t, w) => t.add(w.value ?? 0), new Decimal(0))
          .toString(),
      },
    };
  }
}
