import { IsDateOnly } from '../../common/is-date-only.js';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '../../generated/prisma/enums.js';

export class AttendanceEntryDto {
  @IsInt()
  workerId: number;

  /** null clears the day (not marked) */
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status: AttendanceStatus | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  bonus?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class SaveAttendanceDto {
  @IsDateOnly()
  date: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];
}
