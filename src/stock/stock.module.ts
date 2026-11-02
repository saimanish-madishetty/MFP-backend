import { Module } from '@nestjs/common';
import { ProductionService } from './production.service.js';
import { MaterialsController, StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [MaterialsController, StockController],
  providers: [StockService, ProductionService],
})
export class StockModule {}
