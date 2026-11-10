import { BadRequestException, Injectable } from '@nestjs/common';
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
import { toSaleUnits, toStock } from '../products/packaging.js';
import {
  batchShares,
  expectedUse,
  recipeInclude,
} from '../products/recipe.js';
import { SaveProductionDto } from './dto/movement.dto.js';
import { applyMovement, reverseMovement } from './stock.service.js';

const Decimal = Prisma.Decimal;

/**
 * Wastage = used − expected (negative means less was used than the recipe says). With `cost` (the
 * material's latest price per unit) also its value in ₹: an estimate, at today's price.
 */
function waste(
  used: Prisma.Decimal,
  expected: Prisma.Decimal | null,
  cost?: Prisma.Decimal | null,
) {
  if (expected === null) return { waste: null, wastePct: null, value: null };
  const w = used.sub(expected);
  return {
    waste: w.toString(),
    wastePct: expected.gt(0)
      ? w.div(expected).mul(100).toDecimalPlaces(1).toString()
      : null,
    value: cost ? w.mul(cost).toDecimalPlaces(2).toString() : null,
  };
}

type WasteLine = ReturnType<typeof waste> & {
  material: { id: number; name: string; unit: string };
  used: string;
  expected: string | null;
};

/** A material as the wastage endpoints send it (no price). */
const materialOut = (m: { id: number; name: string; unit: string }) => ({
  id: m.id,
  name: m.name,
  unit: m.unit,
});

/** One material used for a product, compared with the recipe, with its ₹ value. */
function wasteLine(m: {
  quantity: Prisma.Decimal;
  expectedQty: Prisma.Decimal | null;
  material: {
    id: number;
    name: string;
    unit: string;
    lastCostPerUnit: Prisma.Decimal | null;
  };
}): WasteLine {
  const used = m.quantity.neg();
  return {
    material: materialOut(m.material),
    used: used.toString(),
    expected: m.expectedQty?.toString() ?? null,
    ...waste(used, m.expectedQty, m.material.lastCostPerUnit),
  };
}

const sumValues = (values: (string | null)[]) =>
  values.reduce((sum, v) => sum.add(v ?? 0), new Decimal(0)).toString();

const wasteMaterial = {
  select: { id: true, name: true, unit: true, lastCostPerUnit: true },
} as const;

/** First day of the month and of the next one, for a "YYYY-MM" month. */
function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new BadRequestException('Month must look like 2026-11');
  const from = parseDate(`${month}-01`);
  const to = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1),
  );
  return { from, to };
}

/**
 * The production entry for a date (one per date). For each product made: the quantity and the raw
 * materials used for it (compared with its recipe for wastage). Plus materials used for no product
 * in particular, e.g. supplies for the day. Materials used reduce material stock; products made add
 * to finished stock.
 */
@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finished batches matching `where`: each material used, shared out between the products made
   * by what their recipes expect (see batchShares). Dated the day the batch was finished.
   */
  private async batchLines(where: Prisma.BatchWhereInput) {
    const batches = await this.prisma.batch.findMany({
      where: { ...where, status: BatchStatus.FINISHED },
      include: {
        materialMovements: true,
        productMovements: { include: { product: { include: recipeInclude } } },
      },
    });
    return batches.flatMap((b) => {
      const used = new Map<number, Prisma.Decimal>();
      for (const m of b.materialMovements)
        used.set(
          m.materialId,
          (used.get(m.materialId) ?? new Decimal(0)).add(m.quantity.neg()),
        );
      return batchShares(
        b.productMovements.map((m) => ({
          product: m.product,
          quantity: m.quantity,
        })),
        used,
      ).flatMap((w) =>
        w.shares.map((x) => ({
          date: formatDate(b.endDate!),
          batch: b.number,
          productId: x.productId,
          materialId: w.materialId,
          used: x.used,
          expected: x.expected,
        })),
      );
    });
  }

  async forDate(dateStr: string) {
    const entry = await this.prisma.productionEntry.findUnique({
      where: { date: parseDate(dateStr) },
      include: {
        materialMovements: {
          where: { type: StockMovementType.USAGE },
          orderBy: { id: 'asc' },
        },
        productMovements: {
          where: { type: ProductMovementType.PRODUCED },
          include: { product: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!entry) return { date: dateStr, entry: null };
    // Usage is stored as negative movements; the API speaks in positive "used" quantities.
    const used = (m: { quantity: Prisma.Decimal }) => m.quantity.neg();
    return {
      date: dateStr,
      entry: {
        id: entry.id,
        notes: entry.notes,
        updatedAt: entry.updatedAt,
        items: entry.materialMovements
          .filter((m) => m.productId === null)
          .map((m) => ({
            materialId: m.materialId,
            quantity: used(m).toString(),
          })),
        // Products made are entered in sale units (packs, bags); stock is kept in stock units.
        products: entry.productMovements.map((pm) => ({
          productId: pm.productId,
          quantity: toSaleUnits(pm.product, pm.quantity).toString(),
          stockQty: pm.quantity.toString(),
          materials: entry.materialMovements
            .filter((m) => m.productId === pm.productId)
            .map((m) => ({
              materialId: m.materialId,
              quantity: used(m).toString(),
              expected: m.expectedQty?.toString() ?? null,
              ...waste(used(m), m.expectedQty),
            })),
        })),
      },
    };
  }

  async recent(limit = 30) {
    const entries = await this.prisma.productionEntry.findMany({
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        _count: { select: { materialMovements: true, productMovements: true } },
      },
    });
    return entries.map((e) => ({
      id: e.id,
      date: formatDate(e.date),
      notes: e.notes,
      materialsUsed: e._count.materialMovements,
      productsMade: e._count.productMovements,
    }));
  }

  /** Raw materials used for a product vs. its recipe, per production day (latest first), with totals. */
  async wastage(productId: number, limit = 60) {
    const [direct, made, fromBatches, materials] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { productId, type: StockMovementType.USAGE },
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        include: { material: wasteMaterial },
      }),
      this.prisma.productStockMovement.findMany({
        where: { productId, type: ProductMovementType.PRODUCED },
        include: { product: true },
      }),
      this.batchLines({ productMovements: { some: { productId } } }),
      this.prisma.material.findMany(wasteMaterial),
    ]);
    const materialById = new Map(materials.map((m) => [m.id, m]));
    // Batches: this product's share of each material.
    const usage = [
      ...direct,
      ...fromBatches
        .filter((l) => l.productId === productId)
        .map((l) => ({
          date: parseDate(l.date),
          materialId: l.materialId,
          quantity: l.used.neg(),
          expectedQty: l.expected,
          material: materialById.get(l.materialId)!,
        })),
    ];
    // A day can have several entries (the day-end entry and finished batches): added up.
    const madeOn = new Map<
      string,
      { product: (typeof made)[number]['product']; quantity: Prisma.Decimal }
    >();
    for (const m of made) {
      const key = formatDate(m.date);
      const prev = madeOn.get(key);
      madeOn.set(key, {
        product: m.product,
        quantity: prev ? prev.quantity.add(m.quantity) : m.quantity,
      });
    }
    // Every production day, also those with no materials entered for the product.
    const dates = [
      ...new Set([...usage, ...made].map((m) => formatDate(m.date))),
    ]
      .sort()
      .reverse()
      .slice(0, limit);

    const days = new Map<
      string,
      {
        date: string;
        /** In sale units */
        made: string | null;
        /** In stock units, e.g. pieces for 20 packs + 5 pieces */
        madeStock: string | null;
        /** ₹, at today's material prices */
        wasteValue: string;
        materials: WasteLine[];
      }
    >();
    for (const date of dates) {
      const pm = madeOn.get(date);
      days.set(date, {
        date,
        made: pm ? toSaleUnits(pm.product, pm.quantity).toString() : null,
        madeStock: pm ? pm.quantity.toString() : null,
        wasteValue: '0',
        materials: [],
      });
    }
    const totals = new Map<
      number,
      {
        material: (typeof usage)[number]['material'];
        used: Prisma.Decimal;
        expected: Prisma.Decimal;
      }
    >();
    for (const m of usage) {
      const day = days.get(formatDate(m.date));
      if (!day) continue; // older than the last `limit` days
      const used = m.quantity.neg();
      day.materials.push(wasteLine(m));
      if (m.expectedQty !== null) {
        const t = totals.get(m.materialId) ?? {
          material: m.material,
          used: new Decimal(0),
          expected: new Decimal(0),
        };
        t.used = t.used.add(used);
        t.expected = t.expected.add(m.expectedQty);
        totals.set(m.materialId, t);
      }
    }
    return {
      days: [...days.values()].map((d) => ({
        ...d,
        wasteValue: sumValues(d.materials.map((m) => m.value)),
      })),
      totals: [...totals.values()].map((t) => ({
        material: materialOut(t.material),
        used: t.used.toString(),
        expected: t.expected.toString(),
        ...waste(t.used, t.expected, t.material.lastCostPerUnit),
      })),
    };
  }

  /**
   * Wastage screen: every material used for a product, per production day, vs. what the recipe
   * says it should have taken. The screen adds these up for the materials chosen in its filter.
   * `month` ("2026-11") limits it to that month; without it, all days.
   *
   * Raw materials are entered per product, with the recipe's quantity saved at the time. Supplies
   * (covers, boxes, …) are entered for the day as a whole, so for them the expected quantity is
   * worked out from the products made that day and their current recipes, and the day's use is
   * shared out between those products in proportion (`shared`). Materials used for no product and
   * in no recipe that day are left out: there's nothing to compare them with.
   */
  async wastageLines(month?: string) {
    const date = month ? monthRange(month) : undefined;
    const dateWhere = date ? { gte: date.from, lt: date.to } : undefined;
    const [usage, made, materials, fromBatches] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { type: StockMovementType.USAGE, date: dateWhere },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: {
          date: true,
          productId: true,
          materialId: true,
          quantity: true,
          expectedQty: true,
          batchId: true,
        },
      }),
      this.prisma.productStockMovement.findMany({
        where: { type: ProductMovementType.PRODUCED, date: dateWhere },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        include: { product: { include: recipeInclude } },
      }),
      this.prisma.material.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          unit: true,
          lastCostPerUnit: true,
        },
      }),
      this.batchLines(dateWhere ? { endDate: dateWhere } : {}),
    ]);
    const typeOf = new Map(materials.map((m) => [m.id, m.type]));
    const isSupply = (id: number) => typeOf.get(id) === MaterialType.SUPPLY;

    type Line = {
      date: string;
      productId: number;
      materialId: number;
      used: string;
      /** null: the material isn't in the product's recipe (or has no quantity there) */
      expected: string | null;
      /** A supply: the day's use shared out between the products made */
      shared?: true;
      /** From this batch: its use shared out between the products made */
      batch?: string;
    };
    const lines: Line[] = [];

    // Entered per product (raw materials, and supplies from the recipe): expected saved with them.
    const direct = new Set<string>(); // "date|materialId|productId"
    for (const u of usage) {
      if (u.productId === null) continue;
      direct.add(`${formatDate(u.date)}|${u.materialId}|${u.productId}`);
      lines.push({
        date: formatDate(u.date),
        productId: u.productId,
        materialId: u.materialId,
        used: u.quantity.neg().toString(),
        expected: u.expectedQty?.toString() ?? null,
      });
    }

    // Supplies entered for the day as a whole: the day's use vs. what the products made that day
    // (and not given their own line) should have taken.
    const supplyUsed = new Map<string, Prisma.Decimal>(); // "date|materialId"
    for (const u of usage) {
      if (!isSupply(u.materialId) || u.productId !== null || u.batchId !== null)
        continue;
      const key = `${formatDate(u.date)}|${u.materialId}`;
      supplyUsed.set(
        key,
        (supplyUsed.get(key) ?? new Decimal(0)).add(u.quantity.neg()),
      );
    }
    const supplyExpected = new Map<
      string,
      { productId: number; expected: Prisma.Decimal }[]
    >();
    for (const pm of made) {
      if (pm.batchId !== null) continue; // compared within its batch, below
      const units = toSaleUnits(pm.product, pm.quantity);
      for (const r of pm.product.materials) {
        if (!isSupply(r.materialId)) continue;
        const expected = expectedUse(pm.product, r.materialId, units);
        if (expected === null) continue;
        if (direct.has(`${formatDate(pm.date)}|${r.materialId}|${pm.productId}`))
          continue;
        const key = `${formatDate(pm.date)}|${r.materialId}`;
        supplyExpected.set(key, [
          ...(supplyExpected.get(key) ?? []),
          { productId: pm.productId, expected },
        ]);
      }
    }
    for (const [key, shares] of supplyExpected) {
      const [day, materialId] = key.split('|');
      const used = supplyUsed.get(key) ?? new Decimal(0);
      const total = shares.reduce((t, x) => t.add(x.expected), new Decimal(0));
      for (const x of shares)
        lines.push({
          date: day,
          productId: x.productId,
          materialId: Number(materialId),
          used: (total.gt(0) ? used.mul(x.expected).div(total) : new Decimal(0))
            .toDecimalPlaces(3)
            .toString(),
          expected: x.expected.toString(),
          shared: true,
        });
    }
    for (const l of fromBatches)
      lines.push({
        date: l.date,
        productId: l.productId,
        materialId: l.materialId,
        used: l.used.toString(),
        expected: l.expected.toString(),
        shared: true,
        batch: l.batch,
      });
    lines.sort((a, b) => a.date.localeCompare(b.date));

    const usedIds = new Set(lines.map((l) => l.materialId));
    return {
      materials: materials
        .filter((m) => usedIds.has(m.id))
        .map((m) => ({
          ...m,
          lastCostPerUnit: m.lastCostPerUnit?.toString() ?? null,
        })),
      /** Products made: `made` in sale units, `madeStock` in stock units */
      made: made.map((pm) => ({
        date: formatDate(pm.date),
        productId: pm.productId,
        made: toSaleUnits(pm.product, pm.quantity).toString(),
        madeStock: pm.quantity.toString(),
      })),
      lines,
    };
  }

  /** Replaces the whole entry for the date. */
  async save(dto: SaveProductionDto) {
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');
    const products = dto.products ?? [];

    const materialIds = new Set([
      ...dto.items.map((i) => i.materialId),
      ...products.flatMap((p) => (p.materials ?? []).map((m) => m.materialId)),
    ]);
    if (materialIds.size > 0) {
      const found = await this.prisma.material.count({
        where: { id: { in: [...materialIds] } },
      });
      if (found !== materialIds.size)
        throw new BadRequestException('Unknown material in the list');
    }
    const productById = new Map(
      (
        await this.prisma.product.findMany({
          where: { id: { in: products.map((p) => p.productId) } },
          include: recipeInclude,
        })
      ).map((p) => [p.id, p]),
    );
    if (productById.size !== products.length)
      throw new BadRequestException('Unknown product in the list');

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productionEntry.findUnique({
        where: { date },
        include: { materialMovements: true, productMovements: true },
      });
      if (existing) {
        for (const m of existing.materialMovements)
          await reverseMovement(tx, m);
        for (const m of existing.productMovements)
          await reverseProductMovement(tx, m);
      }
      if (dto.items.length === 0 && products.length === 0) {
        if (existing)
          await tx.productionEntry.delete({ where: { id: existing.id } });
        return;
      }
      const entry = existing
        ? await tx.productionEntry.update({
            where: { id: existing.id },
            data: { notes: dto.notes ?? null },
          })
        : await tx.productionEntry.create({ data: { date, notes: dto.notes } });
      for (const item of dto.items) {
        await applyMovement(tx, {
          materialId: item.materialId,
          date,
          type: StockMovementType.USAGE,
          quantity: -item.quantity,
          productionEntryId: entry.id,
        });
      }
      for (const p of products) {
        const product = productById.get(p.productId)!;
        // Stock units (exact for a pack + piece mix); recipes are per sale unit.
        const stock =
          p.stockQty !== undefined
            ? new Decimal(p.stockQty)
            : toStock(product, p.quantity!, product.saleUnit);
        const made = toSaleUnits(product, stock);
        await applyProductMovement(tx, {
          productId: p.productId,
          date,
          type: ProductMovementType.PRODUCED,
          quantity: stock,
          productionEntryId: entry.id,
        });
        for (const m of p.materials ?? []) {
          await applyMovement(tx, {
            materialId: m.materialId,
            date,
            type: StockMovementType.USAGE,
            quantity: -m.quantity,
            productionEntryId: entry.id,
            productId: p.productId,
            expectedQty: expectedUse(product, m.materialId, made),
          });
        }
      }
    });
    return this.forDate(dto.date);
  }
}
