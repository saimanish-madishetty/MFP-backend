import { Module } from '@nestjs/common';
import { BatchesController, BatchPlansController } from './batches.controller.js';
import { BatchesService } from './batches.service.js';

@Module({
  controllers: [BatchPlansController, BatchesController],
  providers: [BatchesService],
})
export class BatchesModule {}
