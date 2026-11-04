import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto.js';

const include = {
  buyer: { select: { id: true, name: true } },
  product: { select: { id: true, internalName: true, publicName: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof include }>;

/** Orders from buyers: product + quantity, open until marked complete. */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** `status`: open (default, soonest deliver-by first) or done (latest completed first). */
  async list(status = 'open') {
    const done = status === 'done';
    const rows = await this.prisma.order.findMany({
      where: { completedAt: done ? { not: null } : null },
      include,
      orderBy: done
        ? [{ completedAt: 'desc' }, { id: 'desc' }]
        : [
            { dueDate: { sort: 'asc', nulls: 'last' } },
            { orderDate: 'asc' },
            { id: 'asc' },
          ],
      take: done ? 200 : 500,
    });
    return rows.map((o) => this.view(o));
  }

  async overview() {
    const today = todayIST();
    const open = await this.prisma.order.findMany({
      where: { completedAt: null },
      include,
      orderBy: [
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { orderDate: 'asc' },
      ],
    });
    return {
      openCount: open.length,
      overdueCount: open.filter((o) => o.dueDate && o.dueDate < today).length,
      next: open.slice(0, 4).map((o) => this.view(o)),
    };
  }

  async create(dto: CreateOrderDto) {
    const product = await this.product(dto.productId);
    await this.buyer(dto.buyerId);
    const order = await this.prisma.order.create({
      data: {
        buyerId: dto.buyerId,
        productId: dto.productId,
        quantity: dto.quantity,
        unit: dto.unit ?? product.saleUnit,
        orderDate: dto.orderDate ? parseDate(dto.orderDate) : todayIST(),
        dueDate: dto.dueDate ? parseDate(dto.dueDate) : null,
        note: dto.note?.trim() || null,
      },
      include,
    });
    return this.view(order);
  }

  async update(id: number, dto: UpdateOrderDto) {
    await this.find(id);
    let unit = dto.unit;
    if (dto.productId !== undefined) {
      const product = await this.product(dto.productId);
      unit ??= product.saleUnit;
    }
    if (dto.buyerId !== undefined) await this.buyer(dto.buyerId);
    const order = await this.prisma.order.update({
      where: { id },
      data: {
        buyerId: dto.buyerId,
        productId: dto.productId,
        quantity: dto.quantity,
        unit,
        ...(dto.orderDate && { orderDate: parseDate(dto.orderDate) }),
        dueDate:
          dto.dueDate === undefined
            ? undefined
            : dto.dueDate
              ? parseDate(dto.dueDate)
              : null,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
      },
      include,
    });
    return this.view(order);
  }

  async complete(id: number) {
    const order = await this.find(id);
    if (order.completedAt)
      throw new BadRequestException('This order is already complete');
    return this.view(
      await this.prisma.order.update({
        where: { id },
        data: { completedAt: new Date() },
        include,
      }),
    );
  }

  /** Marks a completed order as open again (completed by mistake). */
  async reopen(id: number) {
    await this.find(id);
    return this.view(
      await this.prisma.order.update({
        where: { id },
        data: { completedAt: null },
        include,
      }),
    );
  }

  async remove(id: number) {
    await this.find(id);
    await this.prisma.order.delete({ where: { id } });
  }

  // ── Helpers ───────────────────────────────────────────────

  private view(o: OrderRow) {
    return {
      id: o.id,
      buyer: o.buyer,
      product: o.product,
      quantity: o.quantity.toString(),
      unit: o.unit,
      orderDate: formatDate(o.orderDate),
      dueDate: o.dueDate && formatDate(o.dueDate),
      note: o.note,
      completedAt: o.completedAt,
      overdue: !o.completedAt && !!o.dueDate && o.dueDate < todayIST(),
    };
  }

  private async find(id: number) {
    const o = await this.prisma.order.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  private async product(id: number) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new BadRequestException('Product not found');
    return p;
  }

  private async buyer(id: number) {
    const b = await this.prisma.buyer.findUnique({ where: { id } });
    if (!b) throw new BadRequestException('Buyer not found');
    return b;
  }
}
