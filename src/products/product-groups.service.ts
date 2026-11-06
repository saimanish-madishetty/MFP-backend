import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProductsService } from './products.service.js';
import { CreateProductDto } from './dto/product.dto.js';
import {
  CreateProductGroupDto,
  GroupMemberDto,
  UpdateProductGroupDto,
} from './dto/product-group.dto.js';

type Tx = Prisma.TransactionClient;

type GroupNames = {
  name: string;
  publicName: string;
  hsnCode: string | null;
  gstRate: Prisma.Decimal | number | null;
};

/** "Mahadeva Maida Noodles 1.5mm 500g" */
export function sizeName(groupName: string, options: string[]) {
  return [groupName, ...options]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

/** The fields a size takes from its group. */
export function fromGroup(group: GroupNames, options: string[]) {
  return {
    internalName: sizeName(group.name, options),
    publicName: group.publicName,
    hsnCode: group.hsnCode,
    gstRate: group.gstRate,
  };
}

/** Trimmed values, one per dimension, all filled in. */
export function cleanOptions(dimensions: string[], options: string[]) {
  const values = options.map((o) => o.trim());
  if (values.length !== dimensions.length || values.some((v) => !v))
    throw new BadRequestException(
      `Give every size a value for ${dimensions.join(', ')}`,
    );
  return values;
}

const key = (options: string[]) =>
  options.map((o) => o.toLowerCase()).join('|');

/**
 * Product groups: one product in several sizes. The sizes are Product rows; this keeps their
 * shared fields and generated names in step with the group.
 */
@Injectable()
export class ProductGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async get(id: number) {
    const group = await this.prisma.productGroup.findUnique({
      where: { id },
      include: {
        products: {
          select: { id: true, options: true, active: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException('Product group not found');
    return group;
  }

  async create(dto: CreateProductGroupDto) {
    const fields = this.fields(dto);
    const sizes = dto.sizes ?? [];
    const members = await this.checkMembers(
      fields.dimensions,
      dto.members ?? [],
      undefined,
      sizes.map((s) => s.options),
    );
    const id = await this.prisma.$transaction(async (tx) => {
      const group = await tx.productGroup.create({ data: fields });
      await this.applyMembers(tx, group, members);
      return group.id;
    });
    // New sizes go through the normal product checks; if one fails, nothing is kept.
    const created: number[] = [];
    try {
      for (const size of sizes) {
        const p = await this.products.create(
          Object.assign(new CreateProductDto(), size, { groupId: id }),
        );
        created.push(p.id);
      }
    } catch (err) {
      for (const pid of created) await this.products.remove(pid);
      await this.remove(id);
      throw err;
    }
    return this.get(id);
  }

  async update(id: number, dto: UpdateProductGroupDto) {
    await this.get(id);
    const fields = this.fields(dto);
    const members = await this.checkMembers(fields.dimensions, dto.members, id);
    await this.prisma.$transaction(async (tx) => {
      const group = await tx.productGroup.update({
        where: { id },
        data: fields,
      });
      // Sizes left out become products on their own, keeping their current names.
      await tx.product.updateMany({
        where: {
          groupId: id,
          id: { notIn: members.map((m) => m.productId) },
        },
        data: { groupId: null, options: [] },
      });
      await this.applyMembers(tx, group, members);
    });
    return this.get(id);
  }

  /** Splits the group up: every size becomes a product on its own, keeping its name. */
  async remove(id: number) {
    await this.get(id);
    await this.prisma.$transaction([
      this.prisma.product.updateMany({
        where: { groupId: id },
        data: { groupId: null, options: [] },
      }),
      this.prisma.productGroup.delete({ where: { id } }),
    ]);
  }

  private fields(dto: CreateProductGroupDto) {
    return {
      name: dto.name.trim(),
      publicName: dto.publicName.trim(),
      hsnCode: dto.hsnCode?.trim() || null,
      gstRate: dto.gstRate ?? null,
      dimensions: dto.dimensions.map((d) => d.trim()),
    };
  }

  private async checkMembers(
    dimensions: string[],
    members: GroupMemberDto[],
    groupId?: number,
    /** Values of sizes being created along with the group */
    newSizes: string[][] = [],
  ) {
    if (dimensions.length === 0)
      throw new BadRequestException(
        'Add at least one dimension, e.g. Thickness or Weight',
      );
    if (members.length + newSizes.length === 0)
      throw new BadRequestException('Add at least one size');
    const ids = members.map((m) => m.productId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('A product is listed twice');
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { group: { select: { id: true, name: true } } },
    });
    if (products.length !== ids.length)
      throw new BadRequestException('Unknown product in the list');
    const other = products.find((p) => p.group && p.group.id !== groupId);
    if (other)
      throw new BadRequestException(
        `${other.internalName} is already a size of ${other.group!.name}`,
      );
    const seen = new Set<string>();
    for (const values of newSizes) {
      const options = cleanOptions(dimensions, values);
      if (seen.has(key(options)))
        throw new BadRequestException(
          `Two sizes are both ${options.join(' · ')}`,
        );
      seen.add(key(options));
    }
    return members.map((m) => {
      const options = cleanOptions(dimensions, m.options);
      const k = key(options);
      if (seen.has(k))
        throw new BadRequestException(
          `Two sizes are both ${options.join(' · ')}`,
        );
      seen.add(k);
      return { productId: m.productId, options };
    });
  }

  private async applyMembers(
    tx: Tx,
    group: GroupNames & { id: number },
    members: { productId: number; options: string[] }[],
  ) {
    const ids = members.map((m) => m.productId);
    for (const m of members) {
      const data = fromGroup(group, m.options);
      const clash = await tx.product.findFirst({
        where: {
          internalName: { equals: data.internalName, mode: 'insensitive' },
          active: true,
          id: { notIn: ids },
        },
      });
      if (clash)
        throw new ConflictException(
          `A product named "${clash.internalName}" already exists`,
        );
      await tx.product.update({
        where: { id: m.productId },
        data: { ...data, groupId: group.id, options: m.options },
      });
    }
  }
}
