import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { BuyersModule } from './buyers/buyers.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { HealthController } from './health/health.controller.js';
import { OrdersModule } from './orders/orders.module.js';
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
    ProductsModule,
    BuyersModule,
    SalesModule,
    SettingsModule,
    ExpensesModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
