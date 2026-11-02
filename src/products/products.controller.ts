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
import {
  CreateProductDto,
  ProductAdjustmentDto,
  UpdateProductDto,
} from './dto/product.dto.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.products.list(includeInactive === 'true');
  }

  @Get('overview')
  overview() {
    return this.products.overview();
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.products.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Post(':id/adjustments')
  adjust(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ProductAdjustmentDto,
  ) {
    return this.products.adjust(id, dto);
  }

  @Delete('movements/:movementId')
  @HttpCode(204)
  deleteMovement(@Param('movementId', ParseIntPipe) movementId: number) {
    return this.products.deleteMovement(movementId);
  }
}
