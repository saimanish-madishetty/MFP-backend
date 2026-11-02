import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ProductMovementType,
  StockMovementType,
} from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  applyProductMovement,
  reverseProductMovement,
} from '../products/product-stock.js';
import { SaveProductionDto } from './dto/movement.dto.js';
import { applyMovement, reverseMovement } from './stock.service.js';

/**
 * The day-end entry for a date (one per date): materials used, and products made.
 * Materials used reduce material stock; products made add to finished stock.
 */
@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async forDate(dateStr: string) {
    const entry = await this.prisma.productionEntry.findUnique({
      where: { date: parseDate(dateStr) },
      include: {
        materialMovements: { where: { type: StockMovementType.USAGE } },
        productMovements: { where: { type: ProductMovementType.PRODUCED } },
      },
    });
    return {
      date: dateStr,
      entry: entry && {
        id: entry.id,
        notes: entry.notes,
        updatedAt: entry.updatedAt,
        // Usage is stored as negative movements; the API speaks in positive "used" quantities.
        items: entry.materialMovements.map((m) => ({
          materialId: m.materialId,
          quantity: m.quantity.neg().toString(),
        })),
        products: entry.productMovements.map((m) => ({
          productId: m.productId,
          quantity: m.quantity.toString(),
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

  /** Replaces the whole entry for the date. */
  async save(dto: SaveProductionDto) {
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');
    const products = dto.products ?? [];

    if (dto.items.length > 0) {
      const found = await this.prisma.material.count({
        where: { id: { in: dto.items.map((i) => i.materialId) } },
      });
      if (found !== dto.items.length)
        throw new BadRequestException('Unknown material in the list');
    }
    if (products.length > 0) {
      const found = await this.prisma.product.count({
        where: { id: { in: products.map((p) => p.productId) } },
      });
      if (found !== products.length)
        throw new BadRequestException('Unknown product in the list');
    }

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
        await applyProductMovement(tx, {
          productId: p.productId,
          date,
          type: ProductMovementType.PRODUCED,
          quantity: p.quantity,
          productionEntryId: entry.id,
        });
      }
    });
    return this.forDate(dto.date);
  }
}
