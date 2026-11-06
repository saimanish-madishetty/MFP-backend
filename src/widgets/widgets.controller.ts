import { Controller, Get, Module } from '@nestjs/common';
import { todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatQty, formatStock, shortDay } from './format.js';

/** "1.5mm 500g" before "1.8mm 500g", and "500g" before "1500g" (numbers compared as numbers). */
const bySize = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

type Named = {
  internalName: string;
  options: string[];
  group: { name: string } | null;
};

/**
 * How a product shows in a widget row. A size of a product with sizes shows the product's name with
 * the size on its own line, so a narrow widget can't cut the size off. `name` stays the full name
 * for app versions that only read that.
 */
function rowName(p: Named) {
  return {
    name: p.internalName,
    title: p.group?.name ?? p.internalName,
    size: p.group ? p.options.join(' · ') : '',
  };
}

/** Products in name order, the sizes of one product together and in size order. */
function compareProducts(a: Named, b: Named) {
  return (
    bySize.compare(
      a.group?.name ?? a.internalName,
      b.group?.name ?? b.internalName,
    ) || bySize.compare(a.options.join(' '), b.options.join(' '))
  );
}

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
          options: true,
          group: { select: { name: true } },
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
          product: {
            select: {
              internalName: true,
              options: true,
              group: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    products.sort(compareProducts);
    const late = (d: Date | null) => !!d && d < today;
    return {
      stock: {
        products: products.length,
        outOfStock: products.filter((p) => p.currentQty.lte(0)).length,
        items: products.slice(0, MAX_ROWS).map((p) => ({
          ...rowName(p),
          qty: formatStock(p, p.currentQty.toString()),
          out: p.currentQty.lte(0),
        })),
      },
      orders: {
        open: orders.length,
        late: orders.filter((o) => late(o.dueDate)).length,
        items: orders.slice(0, MAX_ROWS).map((o) => ({
          product: o.product.internalName,
          productTitle: rowName(o.product).title,
          size: rowName(o.product).size,
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
