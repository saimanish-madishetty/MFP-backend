import { IsDateOnly } from '../../common/is-date-only.js';
import { PartialType } from '@nestjs/mapped-types';
import {
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
  ValidateIf,
} from 'class-validator';
import { PayCycle, PayType } from '../../generated/prisma/enums.js';

export class CreateWorkerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @IsDateOnly()
  joiningDate: string;

  @IsEnum(PayType)
  payType: PayType;

  /** ₹ per day (DAILY) or per month (MONTHLY) */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  rate: number;

  @ValidateIf((o: CreateWorkerDto) => o.payType === PayType.MONTHLY)
  @IsInt()
  @Min(1)
  @Max(31)
  workingDaysPerMonth?: number;

  @IsEnum(PayCycle)
  payCycle: PayCycle;

  @ValidateIf((o: CreateWorkerDto) => o.payCycle === PayCycle.WEEKLY)
  @IsInt()
  @Min(0)
  @Max(6)
  payWeekday?: number;

  @ValidateIf((o: CreateWorkerDto) => o.payCycle === PayCycle.MONTHLY)
  @IsInt()
  @Min(1)
  @Max(31)
  payMonthDay?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  permanent?: boolean;
}

export class UpdateWorkerDto extends PartialType(CreateWorkerDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
