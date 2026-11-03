import { UpperTrim } from '../../common/upper-trim.js';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMode } from '../../generated/prisma/enums.js';
import { IsDateOnly } from '../../common/is-date-only.js';

export class CreateBuyerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  /** Name printed on invoices; blank = same as name */
  @IsOptional() @IsString() @MaxLength(150) invoiceName?: string | null;

  @IsOptional() @IsString() @MaxLength(100) contactPerson?: string | null;
  @IsOptional() @IsString() @MaxLength(20) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(20) altPhone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(100) state?: string | null;
  @IsOptional() @IsString() @MaxLength(10) pincode?: string | null;

  @UpperTrim()
  @IsOptional()
  @Matches(/^[0-9A-Z]{15}$/, { message: 'GSTIN must be 15 letters/digits' })
  gstin?: string | null;

  /** null = company default */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  creditDays?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}

export class UpdateBuyerDto extends PartialType(CreateBuyerDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AllocationDto {
  @IsInt()
  saleId: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;
}

export class CreatePaymentDto {
  @IsDateOnly()
  date: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsEnum(PaymentMode)
  mode: PaymentMode;

  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;

  /** Which invoices this payment settles. Omitted = oldest unpaid invoices first. */
  @IsOptional()
  @IsArray()
  @ArrayUnique((a: AllocationDto) => a.saleId, {
    message: 'Each invoice can appear only once',
  })
  @ValidateNested({ each: true })
  @Type(() => AllocationDto)
  allocations?: AllocationDto[];
}
