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
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.orders.list(status);
  }

  @Get('overview')
  overview() {
    return this.orders.overview();
  }

  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrderDto) {
    return this.orders.update(id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseIntPipe) id: number) {
    return this.orders.complete(id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@Param('id', ParseIntPipe) id: number) {
    return this.orders.reopen(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.orders.remove(id);
  }
}
