import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { formatDate, todayIST } from '../common/dates.js';
import { ParseDateOnlyPipe } from '../common/parse-date-only.pipe.js';
import { AttendanceService } from './attendance.service.js';
import { SaveAttendanceDto } from './dto/attendance.dto.js';
import { CreateAdvanceDto, CreateSettlementDto } from './dto/payment.dto.js';
import { CreateWorkerDto, UpdateWorkerDto } from './dto/worker.dto.js';
import { WorkersService } from './workers.service.js';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.workers.list(includeInactive === 'true');
  }

  @Get('overview')
  overview() {
    return this.workers.overview();
  }

  @Post()
  create(@Body() dto: CreateWorkerDto) {
    return this.workers.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.workers.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkerDto) {
    return this.workers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.workers.remove(id);
  }

  @Get(':id/attendance')
  attendance(
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month: string = formatDate(todayIST()).slice(0, 7),
  ) {
    return this.workers.attendanceForMonth(id, month);
  }

  @Post(':id/advances')
  addAdvance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.workers.addAdvance(id, dto);
  }

  @Get(':id/settlement-preview')
  settlementPreview(
    @Param('id', ParseIntPipe) id: number,
    @Query('upTo', ParseDateOnlyPipe) upTo?: string,
  ) {
    return this.workers.settlementPreview(id, upTo);
  }

  @Post(':id/settlements')
  settle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSettlementDto,
  ) {
    return this.workers.settle(id, dto);
  }
}

@Controller('advances')
export class AdvancesController {
  constructor(private readonly workers: WorkersService) {}

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.workers.deleteAdvance(id);
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  forDate(@Query('date', ParseDateOnlyPipe) date?: string) {
    return this.attendance.forDate(date ?? formatDate(todayIST()));
  }

  @Put()
  save(@Body() dto: SaveAttendanceDto) {
    return this.attendance.save(dto);
  }
}
