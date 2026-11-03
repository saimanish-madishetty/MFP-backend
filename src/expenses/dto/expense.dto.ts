import { PartialType } from '@nestjs/mapped-types';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaymentMode } from '../../generated/prisma/enums.js';
import { IsDateOnly } from '../../common/is-date-only.js';

export class CreateExpenseDto {
  @IsDateOnly()
  date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  /** e.g. "Transport", "Tea & snacks"; past categories are suggested in the app. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class CreateBillDto {
  /** Who or what, e.g. "Electricity", "Shop rent". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsDateOnly()
  billDate?: string | null;

  @IsDateOnly()
  dueDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class UpdateBillDto extends PartialType(CreateBillDto) {}

export class PayBillDto {
  @IsDateOnly()
  paidOn: string;

  @IsEnum(PaymentMode)
  mode: PaymentMode;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}
