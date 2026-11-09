import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayType, Prisma } from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAdvanceDto, CreateSettlementDto } from './dto/payment.dto.js';
import { CreateWorkerDto, UpdateWorkerDto } from './dto/worker.dto.js';
import { PaySummaryService } from './pay-summary.service.js';

const Decimal = Prisma.Decimal;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pay: PaySummaryService,
  ) {}

  async list(includeInactive: boolean) {
    const workers = await this.prisma.worker.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ active: 'desc' }, { permanent: 'desc' }, { name: 'asc' }],
    });
    return Promise.all(
      workers.map(async (w) => ({
        ...w,
        summary: await this.pay.summarize(w),
      })),
    );
  }

  /** Numbers for the dashboard. */
  async overview() {
    const today = todayIST();
    const workers = await this.list(false);
    const markedToday = await this.prisma.attendance.count({
      where: { date: today, worker: { active: true } },
    });
    const totalPayable = workers.reduce(
      (sum, w) => sum.add(w.summary.payable),
      new Decimal(0),
    );
    return {
      date: formatDate(today),
      activeWorkers: workers.length,
      markedToday,
      totalPayable: totalPayable.toFixed(2),
      payDue: workers
        .filter((w) => w.summary.payDue)
        .map((w) => ({ id: w.id, name: w.name, payable: w.summary.payable })),
    };
  }

  async get(id: number) {
    const worker = await this.findOrThrow(id);
    const [summary, advances, settlements] = await Promise.all([
      this.pay.summarize(worker),
      this.prisma.advance.findMany({
        where: { workerId: id },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.settlement.findMany({
        where: { workerId: id },
        orderBy: { periodEnd: 'desc' },
        include: { reportedChanges: { orderBy: { changedAt: 'asc' } } },
      }),
    ]);
    return { ...worker, summary, advances, settlements };
  }

  create(dto: CreateWorkerDto) {
    return this.prisma.worker.create({
      data: this.toData(dto) as Prisma.WorkerCreateInput,
    });
  }

  async update(id: number, dto: UpdateWorkerDto) {
    await this.findOrThrow(id);
    const { active, ...rest } = dto;
    return this.prisma.worker.update({
      where: { id },
      data: { ...this.toData(rest), ...(active !== undefined && { active }) },
    });
  }

  /**
   * Permanently deletes a worker with all their attendance, corrections, advances and pay history.
   * (Archiving keeps the history; this is for workers added by mistake or no longer wanted at all.)
   */
  async remove(id: number) {
    await this.findOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.attendanceChange.deleteMany({ where: { workerId: id } }),
      this.prisma.attendance.deleteMany({ where: { workerId: id } }),
      this.prisma.advance.deleteMany({ where: { workerId: id } }),
      this.prisma.settlement.deleteMany({ where: { workerId: id } }),
      this.prisma.worker.delete({ where: { id } }),
    ]);
  }

  async attendanceForMonth(id: number, month: string) {
    const worker = await this.findOrThrow(id);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month must be YYYY-MM');
    }
    const from = parseDate(`${month}-01`);
    const to = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
    );
    const [records, lastSettlement] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { workerId: id, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.settlement.findFirst({
        where: { workerId: id },
        orderBy: { periodEnd: 'desc' },
      }),
    ]);
    return {
      month,
      joiningDate: formatDate(worker.joiningDate),
      settledUpTo: lastSettlement ? formatDate(lastSettlement.periodEnd) : null,
      days: records.map((r) => ({
        date: formatDate(r.date),
        status: r.status,
        bonus: r.bonus.toFixed(2),
        earned: r.earned.toFixed(2),
        note: r.note,
      })),
    };
  }

  // ── Advances ──────────────────────────────────────────────

  async addAdvance(id: number, dto: CreateAdvanceDto) {
    await this.findOrThrow(id);
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');
    return this.prisma.advance.create({
      data: {
        workerId: id,
        date,
        amount: dto.amount,
        mode: dto.mode,
        note: dto.note,
      },
    });
  }

  async deleteAdvance(advanceId: number) {
    const advance = await this.prisma.advance.findUnique({
      where: { id: advanceId },
    });
    if (!advance) throw new NotFoundException('Advance not found');
    await this.prisma.advance.delete({ where: { id: advanceId } });
  }

  // ── Settlements ───────────────────────────────────────────

  async settlementPreview(id: number, upTo?: string) {
    const worker = await this.findOrThrow(id);
    const date = upTo ? parseDate(upTo) : todayIST();
    return this.pay.summarize(worker, date);
  }

  async settle(id: number, dto: CreateSettlementDto) {
    const worker = await this.findOrThrow(id);
    const paidOn = parseDate(dto.paidOn);
    const upToStr = dto.upTo ?? dto.paidOn;
    const upTo = parseDate(upToStr);
    if (paidOn > todayIST() || upTo > todayIST())
      throw new BadRequestException('Date cannot be in the future');

    return this.prisma.$transaction(async (tx) => {
      const s = await this.pay.summarize(worker, upTo, tx);
      if (s.lastSettledOn && upToStr <= s.lastSettledOn) {
        throw new BadRequestException(
          `Already settled up to ${s.lastSettledOn}. Choose a later date.`,
        );
      }
      if (upToStr < s.periodStart) {
        throw new BadRequestException(
          'Date is before the start of the pay period',
        );
      }

      const settlement = await tx.settlement.create({
        data: {
          workerId: id,
          periodStart: parseDate(s.periodStart),
          periodEnd: upTo,
          daysWorked: s.daysWorked,
          earned: s.earned,
          bonus: s.bonus,
          advances: s.advances,
          broughtForward: s.broughtForward,
          payable: s.payable,
          amountPaid: dto.amountPaid,
          mode: dto.mode,
          paidOn,
          note: dto.note,
        },
      });
      await tx.attendanceChange.updateMany({
        where: { id: { in: s.pendingChanges.map((c) => c.id) } },
        data: { reportedInSettlementId: settlement.id },
      });
      return settlement;
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  async findOrThrow(id: number) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) throw new NotFoundException('Worker not found');
    return worker;
  }

  private toData(dto: Partial<CreateWorkerDto>): Prisma.WorkerUpdateInput {
    const data: Prisma.WorkerUpdateInput = {
      name: dto.name?.trim(),
      phone: dto.phone,
      role: dto.role,
      payType: dto.payType,
      rate: dto.rate,
      payCycle: dto.payCycle,
      notes: dto.notes,
      permanent: dto.permanent,
      ...(dto.joiningDate && { joiningDate: parseDate(dto.joiningDate) }),
    };
    if (dto.payType !== undefined) {
      data.workingDaysPerMonth =
        dto.payType === PayType.MONTHLY
          ? (dto.workingDaysPerMonth ?? 26)
          : null;
    }
    if (dto.payCycle !== undefined) {
      data.payWeekday = dto.payCycle === 'WEEKLY' ? dto.payWeekday : null;
      data.payMonthDay = dto.payCycle === 'MONTHLY' ? dto.payMonthDay : null;
    }
    return data;
  }
}
