import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../common/is-date-only.js';

export class CreateBatchPlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  /** In order, e.g. ["Mixer", "Strands", "Boiled", "Folded", "Dried", "Packed"] */
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one stage' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'A stage name is empty' })
  @MaxLength(40, { each: true })
  stages: string[];

  /** Products made with this plan (replaces the list) */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  productIds?: number[];
}

export class UpdateBatchPlanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one stage' })
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true, message: 'A stage name is empty' })
  @MaxLength(40, { each: true })
  stages?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  productIds?: number[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class BatchMaterialDto {
  @IsInt()
  materialId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;
}

/** A list of materials, each once. */
const MaterialList = () =>
  applyDecorators(
    IsArray(),
    ArrayUnique((m: BatchMaterialDto) => m.materialId, {
      message: 'Each material can appear only once',
    }),
    ValidateNested({ each: true }),
    Type(() => BatchMaterialDto),
  );

export class StartBatchDto {
  @IsInt()
  planId: number;

  @IsDateOnly()
  date: string;

  /** Raw materials put in; they come out of stock on `date`. */
  @ArrayMinSize(1, { message: 'Add the raw materials used' })
  @MaterialList()
  materials: BatchMaterialDto[];

  /** The sizes (products) to be made */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  productIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsDateOnly()
  date?: string;

  @IsOptional()
  @ArrayMinSize(1, { message: 'Add the raw materials used' })
  @MaterialList()
  materials?: BatchMaterialDto[];

  /** The sizes (products) to be made */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  productIds?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class BatchDateDto {
  @IsDateOnly()
  date: string;
}

export class BatchOutputDto {
  @IsInt()
  productId: number;

  /** In stock units (pieces, kg, …), so a mix like 20 packs + 5 pieces is exact. */
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  stockQty: number;
}

/** Packs made from a batch on a day, and the packing supplies used. The batch stays in process. */
export class PackBatchDto {
  @IsDateOnly()
  date: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Enter what was made' })
  @ArrayUnique((p: BatchOutputDto) => p.productId, {
    message: 'Each product can appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => BatchOutputDto)
  products: BatchOutputDto[];

  /** Packing supplies (and anything else) used */
  @MaterialList()
  supplies: BatchMaterialDto[];
}

/** Closes the batch, with a last packing if `products` are given. */
export class FinishBatchDto {
  @IsDateOnly()
  date: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique((p: BatchOutputDto) => p.productId, {
    message: 'Each product can appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => BatchOutputDto)
  products?: BatchOutputDto[];

  @IsOptional()
  @MaterialList()
  supplies?: BatchMaterialDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CancelBatchDto {
  @IsDateOnly()
  date: string;

  /** true: the materials were lost (they stay used); false: they go back into stock */
  @IsBoolean()
  materialsLost: boolean;

  @ValidateIf((o: CancelBatchDto) => o.reason !== undefined)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
