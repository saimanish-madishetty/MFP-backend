import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service.js';
import { PaySummaryService } from './pay-summary.service.js';
import {
  AdvancesController,
  AttendanceController,
  WorkersController,
} from './workers.controller.js';
import { WorkersService } from './workers.service.js';

@Module({
  controllers: [WorkersController, AdvancesController, AttendanceController],
  providers: [WorkersService, AttendanceService, PaySummaryService],
})
export class WorkersModule {}
