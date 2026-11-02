import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BuyersModule } from './buyers/buyers.module.js';
import { HealthController } from './health/health.controller.js';
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
    WorkersModule,
    StockModule,
    ProductsModule,
    BuyersModule,
    SalesModule,
    SettingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
