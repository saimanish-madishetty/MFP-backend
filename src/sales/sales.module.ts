import { Module } from '@nestjs/common';
import { BuyersModule } from '../buyers/buyers.module.js';
import { SettingsModule } from '../settings/settings.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [BuyersModule, SettingsModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
