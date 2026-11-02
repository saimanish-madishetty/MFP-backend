import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.js';
import { CreateBuyerDto, UpdateBuyerDto } from './dto/buyer.dto.js';
import { LedgerService } from './ledger.service.js';

const Decimal = Prisma.Decimal;

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  async list(includeInactive: boolean) {
    const buyers = await this.prisma.buyer.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    const balances = await this.ledger.balances(buyers.map((b) => b.id));
    return buyers.map((b) => ({ ...b, summary: balances.get(b.id)! }));
  }

  async get(id: number) {
    const buyer = await this.prisma.buyer.findUnique({ where: { id } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    const [summary, timeline, company] = await Promise.all([
      this.ledger.balance(id),
      this.ledger.timeline(id),
      this.settings.company(),
    ]);
    return {
      ...buyer,
      effectiveCreditDays: buyer.creditDays ?? company.defaultCreditDays,
      summary,
      timeline,
    };
  }

  create(dto: CreateBuyerDto) {
    return this.prisma.buyer.create({
      data: this.clean(dto) as Prisma.BuyerCreateInput,
    });
  }

  async update(id: number, dto: UpdateBuyerDto) {
    const buyer = await this.prisma.buyer.findUnique({ where: { id } });
    if (!buyer) throw new NotFoundException('Buyer not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.buyer.update({
        where: { id },
        data: this.clean(dto),
      });
      // A lower opening balance can free up payment money for invoices.
      if (dto.openingBalance !== undefined) await this.ledger.reconcile(tx, id);
      return updated;
    });
  }

  async overview() {
    const balances = await this.ledger.balances();
    let outstanding = new Decimal(0);
    let overdueAmount = new Decimal(0);
    let overdueBuyers = 0;
    for (const b of balances.values()) {
      if (Number(b.balance) > 0) outstanding = outstanding.add(b.balance);
      overdueAmount = overdueAmount.add(b.overdueAmount);
      if (b.overdueCount > 0) overdueBuyers += 1;
    }
    return {
      buyers: balances.size,
      outstanding: outstanding.toFixed(2),
      overdueAmount: overdueAmount.toFixed(2),
      overdueBuyers,
    };
  }

  private clean(dto: UpdateBuyerDto): Prisma.BuyerUpdateInput {
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      data[k] = typeof v === 'string' ? v.trim() || null : v;
    }
    if (typeof data.name !== 'string') delete data.name;
    if (typeof data.gstin === 'string') data.gstin = data.gstin.toUpperCase();
    return data;
  }
}
