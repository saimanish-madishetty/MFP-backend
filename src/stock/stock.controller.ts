import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MaterialType } from '../generated/prisma/enums.js';
import { formatDate, todayIST } from '../common/dates.js';
import { ParseDateOnlyPipe } from '../common/parse-date-only.pipe.js';
import { CreateMaterialDto, UpdateMaterialDto } from './dto/material.dto.js';
import {
  CreateAdjustmentDto,
  CreatePurchaseDto,
  SaveProductionDto,
} from './dto/movement.dto.js';
import { ProductionService } from './production.service.js';
import { StockService } from './stock.service.js';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly stock: StockService) {}

  @Get()
  list(
    @Query('type') type?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    if (type !== undefined && !(type in MaterialType)) {
      throw new BadRequestException('type must be RAW or SUPPLY');
    }
    return this.stock.list(
      type as MaterialType | undefined,
      includeInactive === 'true',
    );
  }

  @Post()
  create(@Body() dto: CreateMaterialDto) {
    return this.stock.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.stock.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMaterialDto,
  ) {
    return this.stock.update(id, dto);
  }

  /** Permanently deletes a material with its whole stock history. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.stock.remove(id);
  }

  @Post(':id/purchases')
  addPurchase(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.stock.addPurchase(id, dto);
  }

  @Post(':id/adjustments')
  addAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAdjustmentDto,
  ) {
    return this.stock.addAdjustment(id, dto);
  }
}

@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly production: ProductionService,
  ) {}

  @Get('overview')
  overview() {
    return this.stock.overview();
  }

  @Get('suppliers')
  suppliers() {
    return this.stock.suppliers();
  }

  @Delete('movements/:id')
  @HttpCode(204)
  deleteMovement(@Param('id', ParseIntPipe) id: number) {
    return this.stock.deleteMovement(id);
  }

  @Get('production')
  getProduction(@Query('date', ParseDateOnlyPipe) date?: string) {
    return this.production.forDate(date ?? formatDate(todayIST()));
  }

  /** Wastage history of one product: raw materials used vs. the recipe, per production day. */
  @Get('production/wastage')
  wastage(@Query('productId', ParseIntPipe) productId: number) {
    return this.production.wastage(productId);
  }

  /** Wastage screen: materials used vs. recipe per product and day (`month` = "2026-11", or all). */
  @Get('production/wastage/lines')
  wastageLines(@Query('month') month?: string) {
    return this.production.wastageLines(month || undefined);
  }

  @Get('production/recent')
  recent() {
    return this.production.recent();
  }

  @Put('production')
  saveProduction(@Body() dto: SaveProductionDto) {
    return this.production.save(dto);
  }
}
