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
import {
  packagingInfo,
  pricePerSaleUnit,
  sellUnits,
  stockUnit,
  toStock,
  unitsLabel,
  type Packaging,
} from './packaging.js';

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
  const pieces = p.piecesPerUnit ?? 1;
  for (const line of p.materials) {
    if (line.qtyPerUnit === null || line.material.lastCostPerUnit === null) {
      missing += 1;
      continue;
    }
    const perUnit = line.perPiece
      ? line.qtyPerUnit.mul(pieces)
      : line.qtyPerUnit;
    total = total.add(perUnit.mul(line.material.lastCostPerUnit));
  }
  const cost = p.materials.length > 0 ? total.toDecimalPlaces(2) : null;
  const price = pricePerSaleUnit(p, p.price).toDecimalPlaces(2);
  return {
    costPerUnit: cost?.toFixed(2) ?? null,
    incomplete: missing > 0,
    pricePerUnit: price.toFixed(2),
    margin: cost !== null && price.gt(0) ? price.sub(cost).toFixed(2) : null,
  };
}

/** Product as returned by the API: adds the cost estimate and packaging (units, conversions). */
function present(p: ProductWithMaterials) {
  return { ...p, cost: costEstimate(p), pack: packagingInfo(p) };
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
    return products.map(present);
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
    return { ...present(product), movements: history };
  }

  async create(dto: CreateProductDto) {
    await this.assertUnique(dto);
    await this.assertMaterials(dto.materials);
    const packaging = this.assertPackaging(this.packagingOf(dto));
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
            create: this.recipe(dto.materials, packaging),
          },
        },
      });
      if (dto.openingQty) {
        await applyProductMovement(tx, {
          productId: created.id,
          date: openingDate,
          type: ProductMovementType.OPENING,
          quantity: toStock(packaging, dto.openingQty, packaging.saleUnit),
          note: 'Opening stock',
        });
      }
      return created;
    });
    return this.get(product.id);
  }

  async update(id: number, dto: UpdateProductDto) {
    const current = await this.findOrThrow(id);
    await this.assertUnique(dto, id);
    await this.assertMaterials(dto.materials);
    const packaging = this.assertPackaging({
      ...this.packagingOf(current),
      ...this.packagingOf(dto),
    });
    if (stockUnit(packaging) !== stockUnit(current)) {
      const used = await this.prisma.productStockMovement.count({
        where: { productId: id },
      });
      if (used > 0)
        throw new BadRequestException(
          "Stock is already recorded for this product, so it can't switch between pieces, weight and whole units. Add a new product for the new packing.",
        );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { ...this.fields(dto), active: dto.active },
      });
      if (dto.materials) {
        await tx.productMaterial.deleteMany({ where: { productId: id } });
        await tx.productMaterial.createMany({
          data: this.recipe(dto.materials, packaging).map((m) => ({
            productId: id,
            ...m,
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
    const unit = dto.unit ?? product.saleUnit;
    if (!sellUnits(product).includes(unit))
      throw new BadRequestException(
        `This product is counted in ${unitsLabel(sellUnits(product))}`,
      );
    const quantity =
      dto.countedQty !== undefined
        ? toStock(product, dto.countedQty, unit).sub(product.currentQty)
        : toStock(product, dto.quantity ?? 0, unit);
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
        piecesPerUnit: true,
        packSize: true,
        packUnit: true,
      },
    });
    return {
      products: products.length,
      outOfStock: products.filter((p) => p.currentQty.lte(0)).length,
      stock: products.map((p) => ({ ...p, pack: packagingInfo(p) })),
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
      piecesPerUnit: dto.piecesPerUnit,
      packSize: dto.packSize,
      packUnit: dto.packUnit,
      saleUnit: dto.saleUnit,
      priceUnit: dto.priceUnit,
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

  /** The packaging fields present in `src` (missing ones are left out, so updates can merge). */
  private packagingOf(src: {
    saleUnit?: Packaging['saleUnit'];
    piecesPerUnit?: number | null;
    packSize?: Prisma.Decimal | number | null;
    packUnit?: Packaging['packUnit'];
    priceUnit?: Packaging['priceUnit'];
  }) {
    const keys = [
      'saleUnit',
      'piecesPerUnit',
      'packSize',
      'packUnit',
      'priceUnit',
    ] as const;
    return Object.fromEntries(
      keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]),
    ) as Partial<typeof src>;
  }

  private assertPackaging(p: ReturnType<ProductsService['packagingOf']>) {
    const packaging: Packaging = {
      saleUnit: p.saleUnit ?? 'PACK',
      piecesPerUnit: p.piecesPerUnit ?? null,
      packSize: p.packSize == null ? null : new Decimal(p.packSize),
      packUnit: p.packUnit ?? null,
      priceUnit: p.priceUnit ?? null,
    };
    if ((packaging.packSize === null) !== (packaging.packUnit === null))
      throw new BadRequestException('Give both the size and its unit');
    if (packaging.piecesPerUnit && packaging.saleUnit === 'PCS')
      throw new BadRequestException(
        "A product sold as pieces can't have pieces inside; choose pack, box or bag",
      );
    const units = sellUnits(packaging);
    if (packaging.priceUnit && !units.includes(packaging.priceUnit))
      throw new BadRequestException(
        `The price can be per ${unitsLabel(units, 'or per')}`,
      );
    return packaging;
  }

  /** Recipe rows; "per piece" only applies to products with pieces. */
  private recipe(materials: ProductMaterialDto[], packaging: Packaging) {
    const pieces = (packaging.piecesPerUnit ?? 0) > 1;
    return materials.map((m) => ({
      materialId: m.materialId,
      qtyPerUnit: m.qtyPerUnit ?? null,
      perPiece: pieces && (m.perPiece ?? false),
    }));
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
