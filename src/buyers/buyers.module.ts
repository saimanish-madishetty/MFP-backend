import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.js';
import { BuyersController, PaymentsController } from './buyers.controller.js';
import { BuyersService } from './buyers.service.js';
import { LedgerService } from './ledger.service.js';

@Module({
  imports: [SettingsModule],
  controllers: [BuyersController, PaymentsController],
  providers: [BuyersService, LedgerService],
  exports: [LedgerService],
})
export class BuyersModule {}
