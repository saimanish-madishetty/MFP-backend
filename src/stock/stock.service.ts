import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Material,
  MaterialType,
  Prisma,
  StockMovementType,
} from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateMaterialDto, UpdateMaterialDto } from './dto/material.dto.js';
import { CreateAdjustmentDto, CreatePurchaseDto } from './dto/movement.dto.js';

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;

export type StockStatus = 'NEGATIVE' | 'LOW' | 'OK';

export function stockStatus(
  m: Pick<Material, 'currentQty' | 'lowStockLevel'>,
): StockStatus {
  if (m.currentQty.isNegative()) return 'NEGATIVE';
  if (m.lowStockLevel !== null && m.currentQty.lte(m.lowStockLevel))
    return 'LOW';
  return 'OK';
}

/**
 * Records a stock movement and updates the material's running total in the same transaction.
 * Every change to stock goes through here (or `reverseMovement`).
 */
export async function applyMovement(
  tx: Tx,
  data: {
    materialId: number;
    date: Date;
    type: StockMovementType;
    quantity: Prisma.Decimal | number;
    costPerUnit?: number;
    supplier?: string;
    note?: string;
    productionEntryId?: number;
    productId?: number;
    expectedQty?: Prisma.Decimal | null;
  },
) {
  const movement = await tx.stockMovement.create({ data });
  await tx.material.update({
    where: { id: data.materialId },
    data: { currentQty: { increment: data.quantity } },
  });
  return movement;
}

export async function reverseMovement(
  tx: Tx,
  movement: { id: number; materialId: number; quantity: Prisma.Decimal },
) {
  await tx.stockMovement.delete({ where: { id: movement.id } });
  await tx.material.update({
    where: { id: movement.materialId },
    data: { currentQty: { decrement: movement.quantity } },
  });
}

function assertNotFuture(date: Date) {
  if (date > todayIST())
    throw new BadRequestException('Date cannot be in the future');
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async list(type: MaterialType | undefined, includeInactive: boolean) {
    const [materials, lastUsed] = await Promise.all([
      this.prisma.material.findMany({
        where: {
          ...(type && { type }),
          ...(!includeInactive && { active: true }),
        },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.stockMovement.groupBy({
        by: ['materialId'],
        where: { type: StockMovementType.USAGE },
        _max: { date: true },
      }),
    ]);
    const lastUsedById = new Map(
      lastUsed.map((u) => [u.materialId, u._max.date]),
    );
    return materials.map((m) => {
      const used = lastUsedById.get(m.id);
      return {
        ...m,
        status: stockStatus(m),
        lastUsedOn: used ? formatDate(used) : null,
      };
    });
  }

  async overview() {
    const today = todayIST();
    const [materials, todayEntry, lastEntry] = await Promise.all([
      this.prisma.material.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.productionEntry.findUnique({ where: { date: today } }),
      this.prisma.productionEntry.findFirst({ orderBy: { date: 'desc' } }),
    ]);
    const attention = materials
      .map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        currentQty: m.currentQty,
        status: stockStatus(m),
      }))
      .filter((m) => m.status !== 'OK');
    return {
      date: formatDate(today),
      materials: materials.length,
      lowStock: attention.filter((m) => m.status === 'LOW'),
      negativeStock: attention.filter((m) => m.status === 'NEGATIVE'),
      dayEndDoneToday: todayEntry !== null,
      lastDayEndOn: lastEntry ? formatDate(lastEntry.date) : null,
    };
  }

  async get(id: number) {
    const material = await this.findOrThrow(id);
    const movements = await this.prisma.stockMovement.findMany({
      where: { materialId: id },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    // Running balance after each movement, walking back from the current total.
    let balance = new Decimal(material.currentQty);
    const history = movements.map((m) => {
      const row = {
        ...m,
        date: formatDate(m.date),
        balanceAfter: balance.toString(),
      };
      balance = balance.sub(m.quantity);
      return row;
    });
    return { ...material, status: stockStatus(material), movements: history };
  }

  async create(dto: CreateMaterialDto) {
    await this.assertNameFree(dto.name);
    const openingDate = dto.openingDate
      ? parseDate(dto.openingDate)
      : todayIST();
    assertNotFuture(openingDate);
    return this.prisma.$transaction(async (tx) => {
      const material = await tx.material.create({
        data: {
          name: dto.name.trim(),
          type: dto.type,
          unit: dto.unit,
          lowStockLevel: dto.lowStockLevel ?? null,
          notes: dto.notes,
          lastCostPerUnit: dto.openingCostPerUnit,
        },
      });
      if (dto.openingQty) {
        await applyMovement(tx, {
          materialId: material.id,
          date: openingDate,
          type: StockMovementType.OPENING,
          quantity: dto.openingQty,
          costPerUnit: dto.openingCostPerUnit,
          note: 'Opening stock',
        });
      }
      return material;
    });
  }

  async update(id: number, dto: UpdateMaterialDto) {
    const material = await this.findOrThrow(id);
    if (dto.name && dto.name.trim() !== material.name)
      await this.assertNameFree(dto.name, id);
    if (dto.unit && dto.unit !== material.unit) {
      const count = await this.prisma.stockMovement.count({
        where: { materialId: id },
      });
      if (count > 0) {
        throw new BadRequestException(
          'The unit cannot be changed once stock has been recorded. Create a new material instead.',
        );
      }
    }
    return this.prisma.material.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        type: dto.type,
        unit: dto.unit,
        notes: dto.notes,
        active: dto.active,
        ...(dto.lowStockLevel !== undefined && {
          lowStockLevel: dto.lowStockLevel,
        }),
      },
    });
  }

  async addPurchase(id: number, dto: CreatePurchaseDto) {
    await this.findOrThrow(id);
    const date = parseDate(dto.date);
    assertNotFuture(date);
    return this.prisma.$transaction(async (tx) => {
      const movement = await applyMovement(tx, {
        materialId: id,
        date,
        type: StockMovementType.PURCHASE,
        quantity: dto.quantity,
        costPerUnit: dto.costPerUnit,
        supplier: dto.supplier?.trim() || undefined,
        note: dto.note,
      });
      await this.refreshLastCost(tx, id);
      return movement;
    });
  }

  async addAdjustment(id: number, dto: CreateAdjustmentDto) {
    const material = await this.findOrThrow(id);
    const date = parseDate(dto.date);
    assertNotFuture(date);
    const quantity =
      dto.countedQty !== undefined
        ? new Decimal(dto.countedQty).sub(material.currentQty)
        : new Decimal(dto.quantity ?? 0);
    if (quantity.isZero())
      throw new BadRequestException(
        'Nothing to adjust: the quantity is unchanged',
      );
    return this.prisma.$transaction((tx) =>
      applyMovement(tx, {
        materialId: id,
        date,
        type: StockMovementType.ADJUSTMENT,
        quantity,
        note: dto.reason.trim(),
      }),
    );
  }

  /** Undo a purchase, adjustment or opening entry entered by mistake. Usage is edited via the day-end entry. */
  async deleteMovement(movementId: number) {
    const movement = await this.prisma.stockMovement.findUnique({
      where: { id: movementId },
    });
    if (!movement) throw new NotFoundException('Stock entry not found');
    if (movement.type === StockMovementType.USAGE) {
      throw new BadRequestException(
        `Usage is changed from the day-end entry for ${formatDate(movement.date)}`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await reverseMovement(tx, movement);
      if (movement.type === StockMovementType.PURCHASE)
        await this.refreshLastCost(tx, movement.materialId);
    });
  }

  async suppliers() {
    const rows = await this.prisma.stockMovement.findMany({
      where: { supplier: { not: null } },
      distinct: ['supplier'],
      select: { supplier: true },
      orderBy: { supplier: 'asc' },
    });
    return rows.map((r) => r.supplier);
  }

  /**
   * Permanently deletes a material: its purchases, usage, adjustments and opening stock, and its lines
   * in product recipes. Production days left with nothing in them are removed too.
   */
  async remove(id: number) {
    await this.findOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.stockMovement.deleteMany({ where: { materialId: id } }),
      this.prisma.productMaterial.deleteMany({ where: { materialId: id } }),
      this.prisma.material.delete({ where: { id } }),
      this.prisma.productionEntry.deleteMany({
        where: {
          materialMovements: { none: {} },
          productMovements: { none: {} },
        },
      }),
    ]);
  }

  async findOrThrow(id: number) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  private async assertNameFree(name: string, exceptId?: number) {
    const existing = await this.prisma.material.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
    });
    if (existing)
      throw new ConflictException(
        `A material named "${existing.name}" already exists`,
      );
  }

  /** Last cost = cost on the most recent purchase that has one; falls back to the opening cost. */
  private async refreshLastCost(tx: Tx, materialId: number) {
    const withCost = (type: StockMovementType) =>
      tx.stockMovement.findFirst({
        where: { materialId, type, costPerUnit: { not: null } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
      });
    const latest =
      (await withCost(StockMovementType.PURCHASE)) ??
      (await withCost(StockMovementType.OPENING));
    await tx.material.update({
      where: { id: materialId },
      data: { lastCostPerUnit: latest?.costPerUnit ?? null },
    });
  }
}
