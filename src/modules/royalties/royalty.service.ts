import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  ApprovalStatus,
  OrderStatus,
  PayoutStatus,
  Prisma,
  RoyaltyStatus,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { AdminPayoutsQueryDTO } from './dto/admin-payouts-query.dto';
import { MonthlyAnalyticsQueryDTO } from './dto/monthly-analytics-query.dto';
import { MyPayoutsQueryDTO } from './dto/my-payouts-query.dto';
import { RequestPayoutDTO } from './dto/request-payout.dto';
import { UpdatePayoutDTO } from './dto/update-payout.dto';

type AuthorBalance = {
  earned: Prisma.Decimal;
  paid: Prisma.Decimal;
  due: Prisma.Decimal;
  pendingWithdraw: Prisma.Decimal;
};

const zero = () => new Prisma.Decimal(0);
const activePayoutStatuses: PayoutStatus[] = [
  PayoutStatus.PENDING,
  PayoutStatus.APPROVED,
  PayoutStatus.PAID,
];
const payoutSelect = {
  id: true,
  code: true,
  amount: true,
  method: true,
  accountNo: true,
  status: true,
  adminNote: true,
  requestedAt: true,
  processedAt: true,
  author: {
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
  processedBy: { select: { id: true, name: true } },
} satisfies Prisma.PayoutRequestSelect;

const adminPayoutTransitions: Record<PayoutStatus, readonly PayoutStatus[]> = {
  [PayoutStatus.PENDING]: [PayoutStatus.APPROVED, PayoutStatus.REJECTED],
  [PayoutStatus.APPROVED]: [PayoutStatus.PAID, PayoutStatus.REJECTED],
  [PayoutStatus.PAID]: [],
  [PayoutStatus.REJECTED]: [],
  [PayoutStatus.CANCELLED]: [],
};

const payoutTabs: Readonly<Record<string, PayoutStatus | undefined>> = {
  all: undefined,
  pending: PayoutStatus.PENDING,
  approved: PayoutStatus.APPROVED,
  paid: PayoutStatus.PAID,
  rejected: PayoutStatus.REJECTED,
  cancelled: PayoutStatus.CANCELLED,
};

function isPrismaError(
  error: unknown,
  ...codes: string[]
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

function decimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function asIso<T extends { requestedAt: Date; processedAt: Date | null }>(
  payout: T,
) {
  return {
    ...payout,
    requestedAt: payout.requestedAt.toISOString(),
    processedAt: payout.processedAt?.toISOString() ?? null,
  };
}

function dhakaMonthBounds(year: number, month: number) {
  const offsetMs = 6 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(year, month - 1, 1) - offsetMs);
  const end = new Date(Date.UTC(year, month, 1) - offsetMs);
  return { start, end };
}

function currentDhakaMonth(date = new Date()) {
  const dhakaDate = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  return {
    year: dhakaDate.getUTCFullYear(),
    month: dhakaDate.getUTCMonth() + 1,
  };
}

function growthPercent(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

@Injectable()
export class RoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('order.completed')
  async handleOrderCompleted(event: { orderId: string }): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.prisma.$transaction(
          async (transaction) => {
            const order = await transaction.order.findUnique({
              where: { id: event.orderId },
              select: { status: true },
            });
            if (!order || order.status !== OrderStatus.COMPLETED) return;

            const items = await transaction.orderItem.findMany({
              where: {
                orderId: event.orderId,
                book: {
                  is: {
                    authorId: { not: null },
                    royaltyRate: { gt: zero() },
                  },
                },
              },
              select: {
                id: true,
                bookId: true,
                unitPrice: true,
                quantity: true,
                book: {
                  select: { authorId: true, royaltyRate: true },
                },
              },
            });
            const royaltyEntries: Prisma.RoyaltyEntryCreateManyInput[] = [];
            for (const item of items) {
              if (!item.book.authorId || item.book.royaltyRate.isZero()) {
                continue;
              }
              const ratePerCopy = item.unitPrice
                .mul(item.book.royaltyRate)
                .div(100)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
              const amount = ratePerCopy
                .mul(item.quantity)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
              royaltyEntries.push({
                authorId: item.book.authorId,
                bookId: item.bookId,
                orderItemId: item.id,
                copies: item.quantity,
                ratePerCopy,
                rate: item.book.royaltyRate,
                amount,
                status: RoyaltyStatus.PAYABLE,
              });
            }
            if (royaltyEntries.length > 0) {
              await transaction.royaltyEntry.createMany({
                data: royaltyEntries,
                skipDuplicates: true,
              });
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (error) {
        if (isPrismaError(error, 'P2034') && attempt < 3) continue;
        throw error;
      }
    }
  }

  @OnEvent('order.reversed')
  async handleOrderReversed(event: { orderId: string }): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.royaltyEntry.deleteMany({
          where: { orderItem: { is: { orderId: event.orderId } } },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getAuthorBalances(
    authorIds: string[],
  ): Promise<Map<string, AuthorBalance>> {
    const balances = new Map(
      authorIds.map((authorId) => [
        authorId,
        { earned: zero(), paid: zero(), due: zero(), pendingWithdraw: zero() },
      ]),
    );
    if (authorIds.length === 0) return balances;

    const [royaltyGroups, payoutGroups] = await Promise.all([
      this.prisma.royaltyEntry.groupBy({
        by: ['authorId'],
        where: { authorId: { in: authorIds } },
        _sum: { amount: true },
      }),
      this.prisma.payoutRequest.groupBy({
        by: ['authorId', 'status'],
        where: {
          authorId: { in: authorIds },
          status: { in: activePayoutStatuses },
        },
        _sum: { amount: true },
      }),
    ]);

    for (const group of royaltyGroups) {
      const current = balances.get(group.authorId);
      if (current) current.earned = group._sum?.amount ?? zero();
    }
    for (const group of payoutGroups) {
      const current = balances.get(group.authorId);
      if (!current) continue;
      const amount = group._sum?.amount ?? zero();
      if (group.status === PayoutStatus.PAID) current.paid = amount;
      if (
        group.status === PayoutStatus.PENDING ||
        group.status === PayoutStatus.APPROVED
      ) {
        current.pendingWithdraw = current.pendingWithdraw.plus(amount);
      }
    }
    for (const current of balances.values()) {
      current.due = current.earned.minus(current.paid);
    }
    return balances;
  }

  async getSummaryMetrics() {
    const [pendingPayoutRequests, settled] = await Promise.all([
      this.prisma.payoutRequest.count({
        where: { status: PayoutStatus.PENDING },
      }),
      this.prisma.payoutRequest.aggregate({
        where: { status: PayoutStatus.PAID },
        _sum: { amount: true },
      }),
    ]);
    return {
      pendingPayoutRequests,
      totalSettledRoyalties: settled._sum.amount ?? zero(),
    };
  }

  async getAnalytics(userId: string) {
    const author = await this.requireAuthorProfile(userId);
    const { year, month } = currentDhakaMonth();
    const thisMonth = dhakaMonthBounds(year, month);
    const previousMonth =
      month === 1
        ? dhakaMonthBounds(year - 1, 12)
        : dhakaMonthBounds(year, month - 1);
    const [
      royaltyTotals,
      payoutGroups,
      currentMonthCopies,
      previousMonthCopies,
    ] = await Promise.all([
      this.prisma.royaltyEntry.aggregate({
        where: { authorId: author.id },
        _sum: { copies: true, amount: true },
      }),
      this.prisma.payoutRequest.groupBy({
        by: ['status'],
        where: {
          authorId: author.id,
          status: { in: activePayoutStatuses },
        },
        _sum: { amount: true },
      }),
      this.prisma.royaltyEntry.aggregate({
        where: {
          authorId: author.id,
          createdAt: { gte: thisMonth.start, lt: thisMonth.end },
        },
        _sum: { copies: true },
      }),
      this.prisma.royaltyEntry.aggregate({
        where: {
          authorId: author.id,
          createdAt: { gte: previousMonth.start, lt: previousMonth.end },
        },
        _sum: { copies: true },
      }),
    ]);

    let paidOut = zero();
    let pendingAmount = zero();
    for (const group of payoutGroups) {
      const amount = group._sum?.amount ?? zero();
      if (group.status === PayoutStatus.PAID) paidOut = amount;
      if (
        group.status === PayoutStatus.PENDING ||
        group.status === PayoutStatus.APPROVED
      ) {
        pendingAmount = pendingAmount.plus(amount);
      }
    }
    const totalCommission = royaltyTotals._sum.amount ?? zero();
    const activePayoutAmount = payoutGroups.reduce(
      (sum, group) => sum.plus(group._sum?.amount ?? zero()),
      zero(),
    );
    const copiesThisMonth = currentMonthCopies._sum.copies ?? 0;
    const copiesLastMonth = previousMonthCopies._sum.copies ?? 0;
    return {
      totalCopiesSold: royaltyTotals._sum.copies ?? 0,
      totalCommission,
      growthThisMonthPercent: growthPercent(copiesThisMonth, copiesLastMonth),
      availableBalance: totalCommission.minus(activePayoutAmount),
      pendingAmount,
      paidOut,
    };
  }

  async getMonthlyAnalytics(userId: string, query: MonthlyAnalyticsQueryDTO) {
    const author = await this.requireAuthorProfile(userId);
    const { start } = dhakaMonthBounds(query.year, 1);
    const yearEnd = dhakaMonthBounds(query.year + 1, 1).start;
    const rows = await this.prisma.$queryRaw<
      { month: number; copies: number }[]
    >`
      SELECT
        EXTRACT(MONTH FROM ("createdAt" + INTERVAL '6 hours'))::int AS month,
        COALESCE(SUM("copies"), 0)::int AS copies
      FROM "RoyaltyEntry"
      WHERE "authorId" = ${author.id}
        AND "createdAt" >= ${start}
        AND "createdAt" < ${yearEnd}
      GROUP BY month
      ORDER BY month
    `;
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const copiesByMonth = new Map(rows.map((row) => [row.month, row.copies]));
    const months = monthNames.map((name, index) => ({
      month: index + 1,
      name,
      copies: copiesByMonth.get(index + 1) ?? 0,
    }));
    const peak = months.reduce(
      (highest, current) =>
        current.copies > highest.copies ? current : highest,
      months[0] ?? { month: 1, name: 'January', copies: 0 },
    );
    return {
      year: query.year,
      months,
      peakMonth: peak.copies > 0 ? peak : null,
    };
  }

  async getAuthorBookAnalytics(userId: string) {
    const author = await this.requireAuthorProfile(userId);
    const books = await this.prisma.book.findMany({
      where: { authorId: author.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        price: true,
        royaltyRate: true,
        status: true,
        category: { select: { id: true, nameBn: true, nameEn: true } },
      },
    });
    const bookIds = books.map((book) => book.id);
    const royaltyGroups =
      bookIds.length === 0
        ? []
        : await this.prisma.royaltyEntry.groupBy({
            by: ['bookId'],
            where: { authorId: author.id, bookId: { in: bookIds } },
            _sum: { copies: true, amount: true },
          });
    const royaltyByBook = new Map(
      royaltyGroups.map((group) => [
        group.bookId,
        {
          copiesSold: group._sum?.copies ?? 0,
          authorCommission: group._sum?.amount ?? zero(),
        },
      ]),
    );
    let totalRoyalty = zero();
    const data = books.map((book) => {
      const royalty = royaltyByBook.get(book.id);
      const authorCommission = royalty?.authorCommission ?? zero();
      totalRoyalty = totalRoyalty.plus(authorCommission);
      return {
        id: book.id,
        title: book.title,
        category: book.category,
        price: book.price,
        commissionRate: book.royaltyRate,
        copiesSold: royalty?.copiesSold ?? 0,
        authorCommission,
        status: book.status,
      };
    });
    return { data, totalRoyalty };
  }

  async requestPayout(userId: string, input: RequestPayoutDTO) {
    const amount = decimal(input.amount);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const author = await this.requireAuthorProfile(userId, transaction);
            const minimum = await this.minimumWithdrawAmount(transaction);
            if (amount.lessThan(minimum)) {
              throw new BadRequestException(
                `The minimum withdrawal amount is ${minimum.toFixed(2)}`,
              );
            }

            const [earned, reserved] = await Promise.all([
              transaction.royaltyEntry.aggregate({
                where: { authorId: author.id },
                _sum: { amount: true },
              }),
              transaction.payoutRequest.aggregate({
                where: {
                  authorId: author.id,
                  status: { in: activePayoutStatuses },
                },
                _sum: { amount: true },
              }),
            ]);
            const availableBalance = (earned._sum.amount ?? zero()).minus(
              reserved._sum?.amount ?? zero(),
            );
            if (amount.greaterThan(availableBalance)) {
              throw new BadRequestException(
                'Payout amount exceeds the available balance',
              );
            }

            const code = await this.nextPayoutCode(transaction);
            const payout = await transaction.payoutRequest.create({
              data: {
                code,
                authorId: author.id,
                amount,
                method: input.method,
                accountNo: input.accountNo.trim(),
                status: PayoutStatus.PENDING,
              },
              select: payoutSelect,
            });
            return asIso(payout);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isPrismaError(error, 'P2002', 'P2034') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002', 'P2034')) {
          throw new ConflictException(
            'Could not reserve the payout balance; please try again',
          );
        }
        throw error;
      }
    }
    throw new ConflictException(
      'Could not reserve the payout balance; please try again',
    );
  }

  async getMyPayouts(userId: string, query: MyPayoutsQueryDTO) {
    const author = await this.requireAuthorProfile(userId);
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const baseWhere: Prisma.PayoutRequestWhereInput = {
      authorId: author.id,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { accountNo: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const selectedStatus = payoutTabs[query.tab ?? 'all'];
    const where: Prisma.PayoutRequestWhereInput = {
      ...baseWhere,
      ...(selectedStatus ? { status: selectedStatus } : {}),
    };
    const [payouts, total, statusGroups] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where,
        skip,
        take,
        orderBy: { requestedAt: 'desc' },
        select: payoutSelect,
      }),
      this.prisma.payoutRequest.count({ where }),
      this.prisma.payoutRequest.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(
      statusGroups.map((group) => [group.status, group._count._all]),
    );
    return {
      data: payouts.map(asIso),
      meta: {
        ...pageMeta(page, limit, total),
        counts: {
          all: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
          pending: counts.get(PayoutStatus.PENDING) ?? 0,
          approved: counts.get(PayoutStatus.APPROVED) ?? 0,
          paid: counts.get(PayoutStatus.PAID) ?? 0,
          rejected: counts.get(PayoutStatus.REJECTED) ?? 0,
          cancelled: counts.get(PayoutStatus.CANCELLED) ?? 0,
        },
      },
    };
  }

  async cancelPayout(userId: string, payoutId: string) {
    const author = await this.requireAuthorProfile(userId);
    const result = await this.prisma.payoutRequest.updateMany({
      where: {
        id: payoutId,
        authorId: author.id,
        status: PayoutStatus.PENDING,
      },
      data: { status: PayoutStatus.CANCELLED },
    });
    if (result.count !== 1) {
      const exists = await this.prisma.payoutRequest.findFirst({
        where: { id: payoutId, authorId: author.id },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Payout request not found');
      throw new ConflictException(
        'Only pending payout requests can be cancelled',
      );
    }
    return this.prisma.payoutRequest.findUniqueOrThrow({
      where: { id: payoutId },
      select: {
        id: true,
        code: true,
        status: true,
        amount: true,
        requestedAt: true,
      },
    });
  }

  async getPayouts(query: AdminPayoutsQueryDTO) {
    this.validateDateRange(query.from, query.to);
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.PayoutRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.authorId ? { authorId: query.authorId } : {}),
      ...(query.from || query.to
        ? {
            requestedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [payouts, total] = await Promise.all([
      this.prisma.payoutRequest.findMany({
        where,
        skip,
        take,
        orderBy: { requestedAt: 'desc' },
        select: payoutSelect,
      }),
      this.prisma.payoutRequest.count({ where }),
    ]);
    return { data: payouts.map(asIso), meta: pageMeta(page, limit, total) };
  }

  async updatePayout(
    adminId: string,
    payoutId: string,
    input: UpdatePayoutDTO,
  ) {
    const payout = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.payoutRequest.findUnique({
        where: { id: payoutId },
        select: {
          id: true,
          code: true,
          amount: true,
          authorId: true,
          status: true,
        },
      });
      if (!current) throw new NotFoundException('Payout request not found');
      if (!adminPayoutTransitions[current.status].includes(input.status)) {
        throw new BadRequestException(
          `Cannot change payout status from ${current.status} to ${input.status}`,
        );
      }

      const processedAt = new Date();
      const updated = await transaction.payoutRequest.updateMany({
        where: { id: payoutId, status: current.status },
        data: {
          status: input.status,
          ...(input.adminNote !== undefined
            ? { adminNote: input.adminNote }
            : {}),
          processedById: adminId,
          processedAt,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'The payout status changed; refresh and try again',
        );
      }
      return {
        payout: await transaction.payoutRequest.findUniqueOrThrow({
          where: { id: payoutId },
          select: payoutSelect,
        }),
        previousStatus: current.status,
        authorId: current.authorId,
        amount: current.amount,
        paidAt: processedAt,
        createdById: adminId,
      };
    });

    if (
      input.status === PayoutStatus.PAID &&
      payout.previousStatus !== PayoutStatus.PAID
    ) {
      this.eventEmitter.emit('payout.paid', {
        payoutId: payout.payout.id,
        authorId: payout.authorId,
        amount: payout.amount,
        payoutCode: payout.payout.code,
        paidAt: payout.paidAt,
        createdById: payout.createdById,
      });
    }
    return asIso(payout.payout);
  }

  private async requireAuthorProfile(
    userId: string,
    reader: Pick<Prisma.TransactionClient, 'authorProfile'> = this.prisma,
  ) {
    const author = await reader.authorProfile.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (!author || author.status !== ApprovalStatus.APPROVED) {
      throw new ForbiddenException('An approved author profile is required');
    }
    return author;
  }

  private async minimumWithdrawAmount(
    transaction: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const setting = await transaction.setting.findUnique({
      where: { key: 'min_withdraw' },
      select: { value: true },
    });
    if (!setting) return new Prisma.Decimal(500);
    const value = setting.value;
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new InternalServerErrorException(
        'The min_withdraw setting must be a non-negative decimal',
      );
    }
    const text = String(value);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
      throw new InternalServerErrorException(
        'The min_withdraw setting must be a non-negative decimal',
      );
    }
    return new Prisma.Decimal(text);
  }

  private async nextPayoutCode(
    transaction: Prisma.TransactionClient,
  ): Promise<string> {
    const payouts = await transaction.payoutRequest.findMany({
      where: { code: { startsWith: 'PR-' } },
      select: { code: true },
    });
    const maxSequence = payouts.reduce((max, payout) => {
      const match = /^PR-(\d+)$/.exec(payout.code);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 1000);
    return `PR-${maxSequence + 1}`;
  }

  private validateDateRange(from?: Date, to?: Date) {
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from cannot be later than to');
    }
  }
}
