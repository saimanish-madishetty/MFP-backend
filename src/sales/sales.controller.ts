import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ParseDateOnlyPipe } from '../common/parse-date-only.pipe.js';
import { CancelSaleDto, MarkPaidDto, SaveSaleDto } from './dto/sale.dto.js';
import { SalesService, type SaleSort } from './sales.service.js';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('buyerId') buyerId?: string,
    @Query('from', ParseDateOnlyPipe) from?: string,
    @Query('to', ParseDateOnlyPipe) to?: string,
    @Query('q') q?: string,
  ) {
    return this.sales.list({
      status,
      buyerId: buyerId ? Number(buyerId) || undefined : undefined,
      from,
      to,
      q: q?.trim() || undefined,
    });
  }

  /** Sales page: a page of invoices plus totals over every match. */
  @Get('search')
  search(
    @Query('status') status?: string,
    @Query('buyerId') buyerId?: string,
    @Query('productId') productId?: string,
    @Query('from', ParseDateOnlyPipe) from?: string,
    @Query('to', ParseDateOnlyPipe) to?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const int = (v?: string) =>
      v ? Number.parseInt(v, 10) || undefined : undefined;
    return this.sales.search({
      status,
      buyerId: int(buyerId),
      productId: int(productId),
      from,
      to,
      q: q?.trim() || undefined,
      sort:
        sort && ['new', 'old', 'high', 'low'].includes(sort)
          ? (sort as SaleSort)
          : undefined,
      offset: int(offset),
      limit: int(limit),
    });
  }

  @Get('overview')
  overview() {
    return this.sales.overview();
  }

  @Post()
  create(@Body() dto: SaveSaleDto) {
    return this.sales.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.sales.get(id);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveSaleDto) {
    return this.sales.update(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelSaleDto) {
    return this.sales.cancel(id, dto);
  }

  @Post(':id/mark-paid')
  markPaid(@Param('id', ParseIntPipe) id: number, @Body() dto: MarkPaidDto) {
    return this.sales.markPaid(id, dto);
  }
}
