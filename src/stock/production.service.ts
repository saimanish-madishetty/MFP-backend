import { BadRequestException, Injectable } from '@nestjs/common';
import {
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
import { SaveProductionDto } from './dto/movement.dto.js';
import { applyMovement, reverseMovement } from './stock.service.js';

const Decimal = Prisma.Decimal;

const recipeInclude = {
  materials: true,
} satisfies Prisma.ProductInclude;

type ProductWithRecipe = Prisma.ProductGetPayload<{
  include: typeof recipeInclude;
}>;

/**
 * How much of a material the recipe says `made` (in sale units) should take, or null when the
 * material isn't in the recipe or its quantity isn't filled in.
 */
function expectedUse(
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

/** Wastage = used − expected (negative means less was used than the recipe says). */
function waste(used: Prisma.Decimal, expected: Prisma.Decimal | null) {
  if (expected === null) return { waste: null, wastePct: null };
  const w = used.sub(expected);
  return {
    waste: w.toString(),
    wastePct: expected.gt(0)
      ? w.div(expected).mul(100).toDecimalPlaces(1).toString()
      : null,
  };
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
    const [usage, made] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { productId, type: StockMovementType.USAGE },
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        include: {
          material: { select: { id: true, name: true, unit: true } },
        },
      }),
      this.prisma.productStockMovement.findMany({
        where: { productId, type: ProductMovementType.PRODUCED },
        include: { product: true },
      }),
    ]);
    const madeOn = new Map(
      made.map((m) => [
        formatDate(m.date),
        toSaleUnits(m.product, m.quantity).toString(),
      ]),
    );

    const days = new Map<
      string,
      {
        date: string;
        made: string | null;
        materials: Record<string, unknown>[];
      }
    >();
    const totals = new Map<
      number,
      {
        material: (typeof usage)[number]['material'];
        used: Prisma.Decimal;
        expected: Prisma.Decimal;
      }
    >();
    for (const m of usage) {
      const date = formatDate(m.date);
      if (!days.has(date)) {
        if (days.size >= limit) continue;
        days.set(date, { date, made: madeOn.get(date) ?? null, materials: [] });
      }
      const used = m.quantity.neg();
      days.get(date)!.materials.push({
        material: m.material,
        used: used.toString(),
        expected: m.expectedQty?.toString() ?? null,
        ...waste(used, m.expectedQty),
      });
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
      days: [...days.values()],
      totals: [...totals.values()].map((t) => ({
        material: t.material,
        used: t.used.toString(),
        expected: t.expected.toString(),
        ...waste(t.used, t.expected),
      })),
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
        await applyProductMovement(tx, {
          productId: p.productId,
          date,
          type: ProductMovementType.PRODUCED,
          quantity: toStock(product, p.quantity, product.saleUnit),
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
            expectedQty: expectedUse(product, m.materialId, p.quantity),
          });
        }
      }
    });
    return this.forDate(dto.date);
  }
}
