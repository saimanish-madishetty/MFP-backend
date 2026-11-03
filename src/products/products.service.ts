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
  sellUnits,
  stockUnit,
  toStock,
  unitPrice,
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
  const price = unitPrice(p, p.saleUnit);
  return {
    costPerUnit: cost?.toFixed(2) ?? null,
    incomplete: missing > 0,
    margin: cost !== null && price?.gt(0) ? price.sub(cost).toFixed(2) : null,
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
          price: packaging.price,
          piecePrice: packaging.piecePrice,
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
        data: {
          ...this.fields(dto),
          price: packaging.price,
          piecePrice: packaging.piecePrice,
          active: dto.active,
        },
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
        price: true,
        piecePrice: true,
      },
    });
    return {
      products: products.length,
      outOfStock: products.filter((p) => p.currentQty.lte(0)).length,
      stock: products.map((p) => ({ ...p, pack: packagingInfo(p) })),
    };
  }

  /**
   * Permanently deletes a product: its stock history and recipe. Raw materials used for it stay in
   * material stock (they were really used) but are no longer linked to it. Products on an invoice
   * can't be deleted, so invoices stay complete; archive those instead.
   */
  async remove(id: number) {
    await this.findOrThrow(id);
    const invoices = await this.prisma.sale.count({
      where: { lines: { some: { productId: id } } },
    });
    if (invoices > 0)
      throw new BadRequestException(
        `This product is on ${invoices} invoice${invoices === 1 ? '' : 's'}, so it can't be deleted. Archive it instead.`,
      );
    await this.prisma.$transaction([
      this.prisma.stockMovement.updateMany({
        where: { productId: id },
        data: { productId: null, expectedQty: null },
      }),
      this.prisma.productStockMovement.deleteMany({ where: { productId: id } }),
      this.prisma.productMaterial.deleteMany({ where: { productId: id } }),
      this.prisma.product.delete({ where: { id } }),
      this.prisma.productionEntry.deleteMany({
        where: {
          materialMovements: { none: {} },
          productMovements: { none: {} },
        },
      }),
    ]);
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
    price?: Prisma.Decimal | number | null;
    piecePrice?: Prisma.Decimal | number | null;
  }) {
    const keys = [
      'saleUnit',
      'piecesPerUnit',
      'packSize',
      'packUnit',
      'price',
      'piecePrice',
    ] as const;
    return Object.fromEntries(
      keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]),
    ) as Partial<typeof src>;
  }

  /** Validates packing and prices; returns them normalised (what gets saved). */
  private assertPackaging(p: ReturnType<ProductsService['packagingOf']>) {
    const dec = (v: Prisma.Decimal | number | null | undefined) =>
      v == null ? null : new Decimal(v);
    const packaging: Packaging = {
      saleUnit: p.saleUnit ?? 'PACK',
      piecesPerUnit: p.piecesPerUnit ?? null,
      packSize: dec(p.packSize),
      packUnit: p.packUnit ?? null,
      price: dec(p.price),
      piecePrice: dec(p.piecePrice),
    };
    if ((packaging.packSize === null) !== (packaging.packUnit === null))
      throw new BadRequestException('Give both the size and its unit');
    if (packaging.piecesPerUnit && packaging.saleUnit === 'PCS')
      throw new BadRequestException(
        "A product sold as pieces can't have pieces inside; choose pack, box or bag",
      );
    // Sold in one unit only: there is just one price.
    if (sellUnits(packaging).length === 1) {
      packaging.price = packaging.price ?? packaging.piecePrice ?? null;
      packaging.piecePrice = null;
    }
    if (packaging.price == null && packaging.piecePrice == null)
      throw new BadRequestException(
        `Enter a selling price per ${unitsLabel(sellUnits(packaging), 'or per')}`,
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
