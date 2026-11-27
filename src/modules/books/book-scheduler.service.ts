import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class BookSchedulerService {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async publishDueBooks(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.book.updateMany({
      where: {
        status: BookStatus.SCHEDULED,
        scheduledAt: { lte: now },
      },
      data: {
        status: BookStatus.PUBLISHED,
        publishedAt: now,
        scheduledAt: null,
      },
    });
    return result.count;
  }
}
