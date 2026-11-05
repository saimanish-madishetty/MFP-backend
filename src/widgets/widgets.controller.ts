import { Controller, Get, Module } from '@nestjs/common';
import { todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatQty, formatStock, shortDay } from './format.js';

/** Rows sent at most; the widget lists scroll. */
const MAX_ROWS = 100;

/**
 * Data for the Android home-screen widgets, ready to show (the widgets don't format anything).
 * Read-only, so view-only users get it too.
 */
@Controller('widgets')
export class WidgetsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async summary() {
    const today = todayIST();
    const [products, orders] = await Promise.all([
      this.prisma.product.findMany({
        where: { active: true },
        orderBy: { internalName: 'asc' },
        select: {
          internalName: true,
          currentQty: true,
          saleUnit: true,
          piecesPerUnit: true,
          packSize: true,
          packUnit: true,
        },
      }),
      this.prisma.order.findMany({
        where: { completedAt: null },
        orderBy: [
          { dueDate: { sort: 'asc', nulls: 'last' } },
          { orderDate: 'asc' },
          { id: 'asc' },
        ],
        include: {
          buyer: { select: { name: true } },
          product: { select: { internalName: true } },
        },
      }),
    ]);

    const late = (d: Date | null) => !!d && d < today;
    return {
      stock: {
        products: products.length,
        outOfStock: products.filter((p) => p.currentQty.lte(0)).length,
        items: products.slice(0, MAX_ROWS).map((p) => ({
          name: p.internalName,
          qty: formatStock(p, p.currentQty.toString()),
          out: p.currentQty.lte(0),
        })),
      },
      orders: {
        open: orders.length,
        late: orders.filter((o) => late(o.dueDate)).length,
        items: orders.slice(0, MAX_ROWS).map((o) => ({
          product: o.product.internalName,
          buyer: o.buyer.name,
          qty: formatQty(o.quantity.toString(), o.unit),
          due: o.dueDate && shortDay(o.dueDate),
          late: late(o.dueDate),
          dueToday: !!o.dueDate && o.dueDate.getTime() === today.getTime(),
        })),
      },
    };
  }
}

@Module({ controllers: [WidgetsController] })
export class WidgetsModule {}
