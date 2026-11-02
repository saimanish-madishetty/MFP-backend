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
  Query,
} from '@nestjs/common';
import { BuyersService } from './buyers.service.js';
import {
  CreateBuyerDto,
  CreatePaymentDto,
  UpdateBuyerDto,
} from './dto/buyer.dto.js';
import { LedgerService } from './ledger.service.js';

@Controller('buyers')
export class BuyersController {
  constructor(
    private readonly buyers: BuyersService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  list(@Query('includeInactive') includeInactive?: string) {
    return this.buyers.list(includeInactive === 'true');
  }

  @Get('overview')
  overview() {
    return this.buyers.overview();
  }

  @Post()
  create(@Body() dto: CreateBuyerDto) {
    return this.buyers.create(dto);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.buyers.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBuyerDto) {
    return this.buyers.update(id, dto);
  }

  @Post(':id/payments')
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.ledger.createPayment(id, dto);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly ledger: LedgerService) {}

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.ledger.deletePayment(id);
  }
}
