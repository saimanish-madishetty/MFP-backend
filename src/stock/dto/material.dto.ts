import { PartialType, OmitType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { MaterialType, Unit } from '../../generated/prisma/enums.js';
import { IsDateOnly } from '../../common/is-date-only.js';

export class CreateMaterialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsEnum(MaterialType)
  type: MaterialType;

  @IsEnum(Unit)
  unit: Unit;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  lowStockLevel?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /** Stock on hand when the material is added (recorded as an OPENING movement). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  openingQty?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingCostPerUnit?: number;

  /** Date the opening stock was counted (defaults to today). */
  @IsOptional()
  @IsDateOnly()
  openingDate?: string;
}

export class UpdateMaterialDto extends PartialType(
  OmitType(CreateMaterialDto, [
    'openingQty',
    'openingCostPerUnit',
    'openingDate',
  ] as const),
) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
