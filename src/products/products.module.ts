import { Module } from '@nestjs/common';
import { ProductGroupsController } from './product-groups.controller.js';
import { ProductGroupsService } from './product-groups.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [ProductsController, ProductGroupsController],
  providers: [ProductsService, ProductGroupsService],
})
export class ProductsModule {}
