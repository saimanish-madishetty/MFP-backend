import { PartialType } from '@nestjs/mapped-types';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { Unit } from '../../generated/prisma/enums.js';
import { IsDateOnly } from '../../common/is-date-only.js';

export class CreateOrderDto {
  @IsInt()
  buyerId: number;

  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  /** Defaults to the product's sale unit. */
  @IsOptional()
  @IsEnum(Unit)
  unit?: Unit;

  /** Defaults to today. */
  @IsOptional()
  @IsDateOnly()
  orderDate?: string;

  /** Deliver by (optional). */
  @IsOptional()
  @IsDateOnly()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}
