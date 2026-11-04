import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserRole } from '../../generated/prisma/enums.js';

const PIN = /^\d{4,6}$/;
const PIN_MESSAGE = 'PIN must be 4 to 6 digits';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(20) phone: string;
  @Matches(PIN, { message: PIN_MESSAGE }) pin: string;
}

export class ChangePinDto {
  @Matches(PIN, { message: PIN_MESSAGE }) currentPin: string;
  @Matches(PIN, { message: PIN_MESSAGE }) newPin: string;
}

export class CreateUserDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsString() @IsNotEmpty() @MaxLength(20) phone: string;
  @IsEnum(UserRole) role: UserRole;
  @Matches(PIN, { message: PIN_MESSAGE }) pin: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) phone?: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsBoolean() active?: boolean;
  /** New PIN (reset); also logs the user out everywhere */
  @IsOptional() @Matches(PIN, { message: PIN_MESSAGE }) pin?: string;
}
