import { Module } from '@nestjs/common';
import { BillsController, ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';

@Module({
  controllers: [ExpensesController, BillsController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
