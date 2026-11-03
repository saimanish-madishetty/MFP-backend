import { PartialType, OmitType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Unit } from '../../generated/prisma/enums.js';
import { IsDateOnly } from '../../common/is-date-only.js';

export class ProductSpecDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  key: string;

  @IsString()
  @MaxLength(200)
  value: string;
}

export class ProductMaterialDto {
  @IsInt()
  materialId: number;

  /** Per sold unit (or per piece when `perPiece`); may be left blank until known. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  qtyPerUnit?: number | null;

  @IsOptional()
  @IsBoolean()
  perPiece?: boolean;
}

export class CreateProductDto {
  /** Owner's name, e.g. "Mahadeva Maida Noodles 1.5mm". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  internalName: string;

  /** Printed on invoices, e.g. "Mahadeva Noodles". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  publicName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string | null;

  /** Pieces inside one unit sold (e.g. 10); blank for single packaging. */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10000)
  piecesPerUnit?: number | null;

  /** Size of each piece, or of the whole unit when there are no pieces. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  packSize?: number | null;

  @IsOptional()
  @IsEnum(Unit)
  packUnit?: Unit | null;

  @IsEnum(Unit)
  saleUnit: Unit;

  /** Price per unit sold (pack, bag, …). Give this, `piecePrice`, or both. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number | null;

  /** Price per piece, or per kg/L, when sold loose. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  piecePrice?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  mrp?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  hsnCode?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  gstRate?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSpecDto)
  specs?: ProductSpecDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique((m: ProductMaterialDto) => m.materialId, {
    message: 'Each material can appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => ProductMaterialDto)
  materials?: ProductMaterialDto[];

  /** Finished stock on hand when the product is added, in sale units (packs, bags, …). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  openingQty?: number;

  @IsOptional()
  @IsDateOnly()
  openingDate?: string;
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['openingQty', 'openingDate'] as const),
) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ProductAdjustmentDto {
  @IsDateOnly()
  date: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  countedQty?: number;

  /** Unit of `quantity`/`countedQty`: the sale unit (default) or the stock unit (pieces, kg). */
  @IsOptional()
  @IsEnum(Unit)
  unit?: Unit;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}
