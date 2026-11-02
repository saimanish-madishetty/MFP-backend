import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../common/is-date-only.js';

export class CreatePurchaseDto {
  @IsDateOnly()
  date: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPerUnit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Either `quantity` (signed change) or `countedQty` (set stock to a physical count). */
export class CreateAdjustmentDto {
  @IsDateOnly()
  date: string;

  @ValidateIf((o: CreateAdjustmentDto) => o.countedQty === undefined)
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQty?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}

export class ProductionItemDto {
  @IsInt()
  materialId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;
}

export class SaveProductionDto {
  @IsDateOnly()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Materials used that day. Empty `items` and `products` removes the day's entry. */
  @IsArray()
  @ArrayUnique((i: ProductionItemDto) => i.materialId, {
    message: 'Each material can appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => ProductionItemDto)
  items: ProductionItemDto[];

  /** Finished products made that day (added to product stock). */
  @IsOptional()
  @IsArray()
  @ArrayUnique((p: ProductionOutputDto) => p.productId, {
    message: 'Each product can appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => ProductionOutputDto)
  products?: ProductionOutputDto[];
}

export class ProductionOutputDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;
}
