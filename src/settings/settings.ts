import { UpperTrim } from '../common/upper-trim.js';
import { Body, Controller, Get, Injectable, Module, Put } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export class UpdateCompanyProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  businessName: string;

  @IsOptional() @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @IsString() @MaxLength(100) state?: string | null;
  @IsOptional() @IsString() @MaxLength(10) pincode?: string | null;
  @IsOptional() @IsString() @MaxLength(20) phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @UpperTrim()
  @IsOptional()
  @Matches(/^[0-9A-Z]{15}$/, { message: 'GSTIN must be 15 letters/digits' })
  gstin?: string | null;

  @IsOptional() @IsString() @MaxLength(20) fssaiNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(100) bankAccountName?: string | null;
  @IsOptional() @IsString() @MaxLength(30) bankAccountNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(15) bankIfsc?: string | null;
  @IsOptional() @IsString() @MaxLength(100) bankName?: string | null;

  @IsOptional()
  @Matches(/^[\w.-]+@[\w.-]+$/, {
    message: 'UPI ID looks wrong (e.g. name@bank)',
  })
  upiId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  invoicePrefix: string;

  @IsOptional() @IsString() @MaxLength(2000) termsText?: string | null;
  @IsOptional() @IsString() @MaxLength(100) signatoryName?: string | null;

  @IsInt()
  @Min(0)
  @Max(365)
  defaultCreditDays: number;

  @IsBoolean()
  pricesIncludeGst: boolean;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The single company profile row; created with defaults on first use. */
  company() {
    return this.prisma.companyProfile.upsert({
      where: { id: 1 },
      create: { id: 1, businessName: 'Mahadeva Foods' },
      update: {},
    });
  }

  updateCompany(dto: UpdateCompanyProfileDto) {
    const clean = Object.fromEntries(
      Object.entries(dto).map(([k, v]) => [
        k,
        typeof v === 'string' ? v.trim() || null : v,
      ]),
    ) as Omit<Prisma.CompanyProfileCreateInput, 'id'>;
    return this.prisma.companyProfile.upsert({
      where: { id: 1 },
      create: { id: 1, ...clean },
      update: clean,
    });
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('company')
  company() {
    return this.settings.company();
  }

  @Put('company')
  updateCompany(@Body() dto: UpdateCompanyProfileDto) {
    return this.settings.updateCompany(dto);
  }
}

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
