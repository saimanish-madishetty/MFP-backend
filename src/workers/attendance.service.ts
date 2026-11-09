import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { formatDate, parseDate, todayIST } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SaveAttendanceDto } from './dto/attendance.dto.js';
import { dayValueFor, earnedFor } from './pay.js';

const Decimal = Prisma.Decimal;

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** All workers who can be marked on `date`, with their attendance for that day. */
  async forDate(dateStr: string) {
    const date = parseDate(dateStr);
    const workers = await this.prisma.worker.findMany({
      where: {
        joiningDate: { lte: date },
        OR: [{ active: true }, { attendance: { some: { date } } }],
      },
      // Permanent workers first, then temporary.
      orderBy: [{ permanent: 'desc' }, { name: 'asc' }],
      include: {
        attendance: { where: { date } },
        settlements: { orderBy: { periodEnd: 'desc' }, take: 1 },
      },
    });

    return {
      date: formatDate(date),
      rows: workers.map((w) => {
        const record = w.attendance[0];
        const settledUpTo = w.settlements[0]?.periodEnd;
        return {
          worker: {
            id: w.id,
            name: w.name,
            role: w.role,
            payType: w.payType,
            permanent: w.permanent,
            active: w.active,
          },
          status: record?.status ?? null,
          bonus: record ? record.bonus.toFixed(2) : '0.00',
          note: record?.note ?? null,
          settled: settledUpTo !== undefined && date <= settledUpTo,
          /** One full day's pay: as saved for the day, or the worker's current rate */
          dayValue: (record?.dayValue ?? dayValueFor(w)).toFixed(2),
        };
      }),
    };
  }

  /**
   * Save one day's attendance for one or more workers.
   * Changes to days that were already paid are logged and carried into the next settlement.
   */
  async save(dto: SaveAttendanceDto) {
    const date = parseDate(dto.date);
    if (date > todayIST())
      throw new BadRequestException('Date cannot be in the future');

    const workerIds = dto.entries.map((e) => e.workerId);
    if (new Set(workerIds).size !== workerIds.length) {
      throw new BadRequestException('Each worker can appear only once');
    }

    return this.prisma.$transaction(async (tx) => {
      const workers = await tx.worker.findMany({
        where: { id: { in: workerIds } },
        include: {
          attendance: { where: { date } },
          settlements: { orderBy: { periodEnd: 'desc' }, take: 1 },
        },
      });
      const byId = new Map(workers.map((w) => [w.id, w]));
      let changesLogged = 0;

      for (const entry of dto.entries) {
        const worker = byId.get(entry.workerId);
        if (!worker)
          throw new NotFoundException(`Worker ${entry.workerId} not found`);
        if (date < worker.joiningDate) {
          throw new BadRequestException(
            `${worker.name} had not joined on ${dto.date}`,
          );
        }

        const existing = worker.attendance[0];
        const settledUpTo = worker.settlements[0]?.periodEnd;
        const settled = settledUpTo !== undefined && date <= settledUpTo;
        const status = entry.status ?? null;
        const bonus = new Decimal(status === null ? 0 : (entry.bonus ?? 0));
        const oldEarned = existing?.earned ?? new Decimal(0);
        let newEarned = new Decimal(0);
        let attendanceId: number | null = existing?.id ?? null;

        if (status === null) {
          if (existing)
            await tx.attendance.delete({ where: { id: existing.id } });
          attendanceId = null;
        } else {
          const dayValue = existing?.dayValue ?? dayValueFor(worker);
          newEarned = earnedFor(dayValue, status, bonus);
          const saved = await tx.attendance.upsert({
            where: { workerId_date: { workerId: worker.id, date } },
            create: {
              workerId: worker.id,
              date,
              status,
              dayValue,
              bonus,
              earned: newEarned,
              note: entry.note,
            },
            update: { status, bonus, earned: newEarned, note: entry.note },
          });
          attendanceId = saved.id;
        }

        const changed =
          (existing?.status ?? null) !== status ||
          !new Decimal(existing?.bonus ?? 0).equals(bonus);
        if (settled && changed) {
          await tx.attendanceChange.create({
            data: {
              attendanceId,
              workerId: worker.id,
              date,
              oldStatus: existing?.status ?? null,
              oldBonus: existing?.bonus ?? 0,
              newStatus: status,
              newBonus: bonus,
              difference: newEarned.sub(oldEarned),
            },
          });
          changesLogged += 1;
        }
      }

      return { saved: dto.entries.length, changesLogged };
    });
  }
}
