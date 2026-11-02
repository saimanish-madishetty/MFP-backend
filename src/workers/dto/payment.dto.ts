import { IsDateOnly } from '../../common/is-date-only.js';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentMode } from '../../generated/prisma/enums.js';

export class CreateAdvanceDto {
  @IsDateOnly()
  date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class CreateSettlementDto {
  /** Pay period ends on this date (and payment is made on it). */
  @IsDateOnly()
  paidOn: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amountPaid: number;

  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
