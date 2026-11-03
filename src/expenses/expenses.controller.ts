import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { formatDate, todayIST } from '../common/dates.js';
import {
  CreateBillDto,
  CreateExpenseDto,
  PayBillDto,
  UpdateBillDto,
  UpdateExpenseDto,
} from './dto/expense.dto.js';
import { ExpensesService } from './expenses.service.js';

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query('month') month: string = formatDate(todayIST()).slice(0, 7)) {
    return this.expenses.listExpenses(month);
  }

  @Get('categories')
  categories() {
    return this.expenses.categories();
  }

  @Get('overview')
  overview() {
    return this.expenses.overview();
  }

  @Post()
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.createExpense(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateExpenseDto) {
    return this.expenses.updateExpense(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.expenses.deleteExpense(id);
  }
}

@Controller('bills')
export class BillsController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.expenses.listBills(status);
  }

  @Post()
  create(@Body() dto: CreateBillDto) {
    return this.expenses.createBill(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBillDto) {
    return this.expenses.updateBill(id, dto);
  }

  @Post(':id/pay')
  pay(@Param('id', ParseIntPipe) id: number, @Body() dto: PayBillDto) {
    return this.expenses.payBill(id, dto);
  }

  @Post(':id/unpay')
  unpay(@Param('id', ParseIntPipe) id: number) {
    return this.expenses.unpayBill(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.expenses.deleteBill(id);
  }
}
