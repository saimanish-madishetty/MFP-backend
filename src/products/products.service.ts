import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductMovementType } from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateProductDto,
  ProductAdjustmentDto,
  ProductMaterialDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import {
  applyProductMovement,
  reverseProductMovement,
} from './product-stock.js';

const Decimal = Prisma.Decimal;

const materialsInclude = {
  materials: {
    include: {
      material: {
        select: {
          id: true,
          name: true,
          type: true,
          unit: true,
          lastCostPerUnit: true,
          active: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.ProductInclude;

type ProductWithMaterials = Prisma.ProductGetPayload<{
  include: typeof materialsInclude;
}>;

/** Estimated material cost per sold unit from recipe × last material cost. */
function costEstimate(p: ProductWithMaterials) {
  let total = new Decimal(0);
  let missing = 0;
  for (const line of p.materials) {
    if (line.qtyPerUnit === null || line.material.lastCostPerUnit === null) {
      missing += 1;
      continue;
    }
    total = total.add(line.qtyPerUnit.mul(line.material.lastCostPerUnit));
  }
  const cost = p.materials.length > 0 ? total.toDecimalPlaces(2) : null;
  return {
    costPerUnit: cost?.toFixed(2) ?? null,
    incomplete: missing > 0,
    margin:
      cost !== null && p.price.gt(0) ? p.price.sub(cost).toFixed(2) : null,
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeInactive: boolean) {
    const products = await this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { internalName: 'asc' }],
      include: materialsInclude,
    });
    return products.map((p) => ({ ...p, cost: costEstimate(p) }));
  }

  async get(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: materialsInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    const movements = await this.prisma.productStockMovement.findMany({
      where: { productId: id },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 200,
      include: { sale: { select: { id: true, invoiceNumber: true } } },
    });
    let balance = new Decimal(product.currentQty);
    const history = movements.map((m) => {
      const row = {
        ...m,
        date: formatDate(m.date),
        balanceAfter: balance.toString(),
      };
      balance = balance.sub(m.quantity);
      return row;
    });
    return { ...product, cost: costEstimate(product), movements: history };
  }

  async create(dto: CreateProductDto) {
    await this.assertUnique(dto);
    await this.assertMaterials(dto.materials);
    const openingDate = dto.openingDate
      ? parseDate(dto.openingDate)
      : todayIST();
    if (openingDate > todayIST())
      throw new BadRequestException('Date cannot be in the future');

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          ...this.fields(dto),
          materials: dto.materials && {
            create: dto.materials.map((m) => ({
              materialId: m.materialId,
              qtyPerUnit: m.qtyPerUnit ?? null,
            })),
          },
        },
      });
      if (dto.openingQty) {
        await applyProductMovement(tx, {
          productId: created.id,
          date: openingDate,
          type: ProductMovementType.OPENING,
          quantity: dto.openingQty,
          note: 'Opening stock',
        });
      }
      return created;
    });
    return this.get(product.id);
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOrThrow(id);
    await this.assertUnique(dto, id);
    await this.assertMaterials(dto.materials);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { ...this.fields(dto), active: dto.active },
      });
      if (dto.materials) {
        await tx.productMaterial.deleteMany({ where: { productId: id } });
        await tx.productMaterial.createMany({
          data: dto.materials.map((m) => ({
            productId: id,
            materialId: m.materialId,
            qtyPerUnit: m.qtyPerUnit ?? null,
          })),
        });
      }
    });
    return this.get(id);
  }

  async adjust(id: number, dto: ProductAdjustmentDto) {
    const product = await this.findOrThrow(id);
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');
    if (dto.quantity === undefined && dto.countedQty === undefined) {
      throw new BadRequestException('Give a quantity or a counted quantity');
    }
    const quantity =
      dto.countedQty !== undefined
        ? new Decimal(dto.countedQty).sub(product.currentQty)
        : new Decimal(dto.quantity ?? 0);
    if (quantity.isZero())
      throw new BadRequestException(
        'Nothing to adjust: the quantity is unchanged',
      );
    return this.prisma.$transaction((tx) =>
      applyProductMovement(tx, {
        productId: id,
        date,
        type: ProductMovementType.ADJUSTMENT,
        quantity,
        note: dto.reason.trim(),
      }),
    );
  }

  /** Undo an opening or adjustment entry. Production and sales are changed from their own screens. */
  async deleteMovement(movementId: number) {
    const movement = await this.prisma.productStockMovement.findUnique({
      where: { id: movementId },
    });
    if (!movement) throw new NotFoundException('Stock entry not found');
    if (
      movement.type !== ProductMovementType.OPENING &&
      movement.type !== ProductMovementType.ADJUSTMENT
    ) {
      throw new BadRequestException(
        'This entry comes from a day-end entry or a sale; change it there',
      );
    }
    await this.prisma.$transaction((tx) =>
      reverseProductMovement(tx, movement),
    );
  }

  async overview() {
    const products = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: { internalName: 'asc' },
      select: {
        id: true,
        internalName: true,
        currentQty: true,
        saleUnit: true,
      },
    });
    return {
      products: products.length,
      outOfStock: products.filter((p) => p.currentQty.lte(0)).length,
      stock: products,
    };
  }

  async findOrThrow(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private fields(dto: Partial<CreateProductDto>) {
    return {
      internalName: dto.internalName?.trim(),
      publicName: dto.publicName?.trim(),
      code: dto.code === undefined ? undefined : dto.code?.trim() || null,
      packSize: dto.packSize,
      packUnit: dto.packUnit,
      saleUnit: dto.saleUnit,
      price: dto.price,
      mrp: dto.mrp,
      hsnCode:
        dto.hsnCode === undefined ? undefined : dto.hsnCode?.trim() || null,
      gstRate: dto.gstRate,
      specs:
        dto.specs === undefined
          ? undefined
          : dto.specs
              .filter((s) => s.key.trim())
              .map((s) => ({ key: s.key.trim(), value: s.value.trim() })),
    } as Prisma.ProductUncheckedCreateInput;
  }

  private async assertUnique(
    dto: Partial<CreateProductDto>,
    exceptId?: number,
  ) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    if (dto.internalName) {
      const existing = await this.prisma.product.findFirst({
        where: {
          internalName: {
            equals: dto.internalName.trim(),
            mode: 'insensitive',
          },
          ...not,
        },
      });
      if (existing)
        throw new ConflictException(
          `A product named "${existing.internalName}" already exists`,
        );
    }
    if (dto.code?.trim()) {
      const existing = await this.prisma.product.findFirst({
        where: {
          code: { equals: dto.code.trim(), mode: 'insensitive' },
          ...not,
        },
      });
      if (existing)
        throw new ConflictException(
          `Code "${existing.code}" is already used by ${existing.internalName}`,
        );
    }
  }

  private async assertMaterials(materials?: ProductMaterialDto[]) {
    if (!materials?.length) return;
    const found = await this.prisma.material.count({
      where: { id: { in: materials.map((m) => m.materialId) } },
    });
    if (found !== materials.length)
      throw new BadRequestException('Unknown material in the list');
  }
}
