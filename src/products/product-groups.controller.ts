import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  CreateProductGroupDto,
  UpdateProductGroupDto,
} from './dto/product-group.dto.js';
import { ProductGroupsService } from './product-groups.service.js';

@Controller('product-groups')
export class ProductGroupsController {
  constructor(private readonly groups: ProductGroupsService) {}

  @Post()
  create(@Body() dto: CreateProductGroupDto) {
    return this.groups.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.groups.get(id);
  }

  /** Replaces the group's details and its full list of sizes. */
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductGroupDto,
  ) {
    return this.groups.update(id, dto);
  }

  /** Splits the group: each size becomes a product on its own. */
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.groups.remove(id);
  }
}
