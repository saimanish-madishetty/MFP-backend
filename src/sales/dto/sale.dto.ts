import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMode } from '../../generated/prisma/enums.js';
import { IsDateOnly } from '../../common/is-date-only.js';

export class SaleLineDto {
  @IsInt()
  productId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rate: number;

  /** ₹ off this line */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
}

export class PaidNowDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsEnum(PaymentMode)
  mode: PaymentMode;

  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class SaveSaleDto {
  @IsInt()
  buyerId: number;

  @IsDateOnly()
  date: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item' })
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines: SaleLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Payment received with the sale (new sales only). */
  @IsOptional()
  @ValidateNested()
  @Type(() => PaidNowDto)
  paidNow?: PaidNowDto;
}

export class CancelSaleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason: string;
}

export class MarkPaidDto {
  @IsDateOnly()
  date: string;

  @IsEnum(PaymentMode)
  mode: PaymentMode;

  @IsOptional() @IsString() @MaxLength(100) reference?: string;
}
