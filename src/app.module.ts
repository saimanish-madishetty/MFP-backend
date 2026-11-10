import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { BatchesModule } from './batches/batches.module.js';
import { BuyersModule } from './buyers/buyers.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { HealthController } from './health/health.controller.js';
import { OrdersModule } from './orders/orders.module.js';
import { WidgetsModule } from './widgets/widgets.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductsModule } from './products/products.module.js';
import { SalesModule } from './sales/sales.module.js';
import { SettingsModule } from './settings/settings.js';
import { StockModule } from './stock/stock.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    WorkersModule,
    StockModule,
    BatchesModule,
    ProductsModule,
    BuyersModule,
    SalesModule,
    SettingsModule,
    ExpensesModule,
    OrdersModule,
    WidgetsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
