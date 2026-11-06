import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** A product that is (or becomes) one size of the group, with its value for each dimension. */
export class GroupMemberDto {
  @IsInt()
  productId: number;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  options: string[];
}

export class CreateProductGroupDto {
  /** e.g. "Mahadeva Maida Noodles" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  /** Printed on invoices, e.g. "Mahadeva Noodles" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  publicName: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  hsnCode?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  gstRate?: number | null;

  /** e.g. ["Thickness", "Weight"] */
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique((d: string) => d.trim().toLowerCase(), {
    message: 'Each dimension can appear only once',
  })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(30, { each: true })
  dimensions: string[];

  /**
   * Every size of the group, with its values. On update this is the full list: products left out
   * stop being sizes of the group (they become products on their own, keeping their names).
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupMemberDto)
  members: GroupMemberDto[];
}

export class UpdateProductGroupDto extends CreateProductGroupDto {}
