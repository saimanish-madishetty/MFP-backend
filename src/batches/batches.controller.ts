import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BatchStatus } from '../generated/prisma/enums.js';
import { BatchesService } from './batches.service.js';
import {
  BatchDateDto,
  CancelBatchDto,
  CreateBatchPlanDto,
  FinishBatchDto,
  StartBatchDto,
  UpdateBatchDto,
  UpdateBatchPlanDto,
} from './dto/batch.dto.js';

@Controller('batch-plans')
export class BatchPlansController {
  constructor(private readonly batches: BatchesService) {}

  @Get()
  list() {
    return this.batches.plans();
  }

  @Post()
  create(@Body() dto: CreateBatchPlanDto) {
    return this.batches.createPlan(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBatchPlanDto,
  ) {
    return this.batches.updatePlan(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.batches.removePlan(id);
  }
}

@Controller('batches')
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  /** `status` = OPEN, FINISHED or CANCELLED; without it, the latest 100 of any status. */
  @Get()
  list(@Query('status') status?: string) {
    if (status !== undefined && !(status in BatchStatus))
      throw new BadRequestException('status must be OPEN, FINISHED or CANCELLED');
    return this.batches.list(status as BatchStatus | undefined);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.batches.get(id);
  }

  @Post()
  start(@Body() dto: StartBatchDto) {
    return this.batches.start(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBatchDto) {
    return this.batches.update(id, dto);
  }

  @Post(':id/next-stage')
  nextStage(@Param('id', ParseIntPipe) id: number, @Body() dto: BatchDateDto) {
    return this.batches.nextStage(id, dto.date);
  }

  @Post(':id/undo-stage')
  undoStage(@Param('id', ParseIntPipe) id: number) {
    return this.batches.undoStage(id);
  }

  @Post(':id/finish')
  finish(@Param('id', ParseIntPipe) id: number, @Body() dto: FinishBatchDto) {
    return this.batches.finish(id, dto);
  }

  @Post(':id/reopen')
  reopen(@Param('id', ParseIntPipe) id: number) {
    return this.batches.reopen(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelBatchDto) {
    return this.batches.cancel(id, dto);
  }
}
