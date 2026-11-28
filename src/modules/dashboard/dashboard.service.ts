import { Injectable } from '@nestjs/common';
import {
  DeliveryStatus,
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  ReviewStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import type { AuthUser } from '../../common/types/auth-user';
import type { DashboardQueryDTO } from './dto/dashboard-query.dto';

type DateRange = { start: Date; end: Date; month: string };
type CachedAdminDashboard = {
  expiresAt: number;
  value: Record<string, unknown>;
};

const activeOrderStatuses: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.PENDING,
  OrderStatus.PROCESSING,
];
const revenueOrderFilter: Prisma.OrderWhereInput = {
  OR: [
    { status: OrderStatus.COMPLETED },
    { paymentStatus: PaymentStatus.PAID },
  ],
};

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function dhakaDateString(date = new Date()): string {
  return new Date(date.getTime() + 6 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function dateRange(dateString: string): { start: Date; end: Date } {
  const [year, month, day] = dateString.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, day) - 6 * 60 * 60 * 1000),
    end: new Date(Date.UTC(year, month - 1, day + 1) - 6 * 60 * 60 * 1000),
  };
}

function monthRange(month?: string): DateRange {
  const selected = month ?? dhakaDateString().slice(0, 7);
  const [year, monthNumber] = selected.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1) - 6 * 60 * 60 * 1000),
    end: new Date(Date.UTC(year, monthNumber, 1) - 6 * 60 * 60 * 1000),
    month: selected,
  };
}

function previousMonthRange(range: DateRange): { start: Date; end: Date } {
  const start = new Date(range.start);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return { start, end: range.start };
}

function percentChange(current: Prisma.Decimal, previous: Prisma.Decimal) {
  if (previous.isZero()) return current.isZero() ? 0 : 100;
  return current
    .minus(previous)
    .mul(100)
    .div(previous)
    .toDecimalPlaces(2)
    .toNumber();
}

@Injectable()
export class DashboardService {
  private readonly adminCache = new Map<string, CachedAdminDashboard>();

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: AuthUser, query: DashboardQueryDTO) {
    switch (user.role) {
      case UserRole.SUPER_ADMIN:
      case UserRole.ADMIN:
        return this.getAdminDashboard(query);
      case UserRole.WORKER:
        return this.getWorkerDashboard(query);
      case UserRole.AUTHOR:
        return this.getAuthorDashboard(user.id);
      case UserRole.USER:
        return this.getReaderDashboard(user.id);
      default:
        return {};
    }
  }

  private async getAdminDashboard(query: DashboardQueryDTO) {
    const date = query.date ? dhakaDateString(query.date) : dhakaDateString();
    const range = monthRange(query.month);
    const key = `${date}:${range.month}`;
    const cached = this.adminCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const [
      books,
      users,
      sales,
      revenue,
      monthExpenses,
      authors,
      bestSellingToday,
      bestSellingMonth,
      profitOverview,
    ] = await Promise.all([
      this.prisma.book.count(),
      this.prisma.user.count(),
      this.prisma.order.count(),
      this.prisma.order.aggregate({
        where: revenueOrderFilter,
        _sum: { total: true },
      }),
      this.prisma.costEntry.aggregate({
        where: { date: { gte: range.start, lt: range.end } },
        _sum: { amount: true },
      }),
      this.prisma.user.count({ where: { role: UserRole.AUTHOR } }),
      this.getBestSelling(dateRange(date)),
      this.getBestSelling(range),
      this.getProfitOverview(range),
    ]);

    const value = {
      totals: {
        books,
        users,
        sales,
        revenue: revenue._sum.total ?? zero(),
        thisMonthExpense: monthExpenses._sum.amount ?? zero(),
        authors,
      },
      bestSellingToday,
      bestSellingMonth,
      profitOverview,
    };
    this.adminCache.set(key, { value, expiresAt: Date.now() + 60_000 });
    for (const [cacheKey, entry] of this.adminCache) {
      if (entry.expiresAt <= Date.now()) this.adminCache.delete(cacheKey);
    }
    return value;
  }

  private async getBestSelling(range: { start: Date; end: Date }) {
    const groups = await this.prisma.orderItem.groupBy({
      by: ['bookId'],
      where: {
        order: {
          is: {
            ...revenueOrderFilter,
            placedAt: { gte: range.start, lt: range.end },
          },
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });
    if (groups.length === 0) return [];
    const books = await this.prisma.book.findMany({
      where: { id: { in: groups.map((group) => group.bookId) } },
      select: { id: true, title: true, coverImageUrl: true, authorName: true },
    });
    const bookMap = new Map(books.map((book) => [book.id, book]));
    return groups.flatMap((group) => {
      const book = bookMap.get(group.bookId);
      return book ? [{ ...book, copiesSold: group._sum?.quantity ?? 0 }] : [];
    });
  }

  private async getProfitOverview(range: DateRange) {
    const previousRange = previousMonthRange(range);
    const [
      revenue,
      expenses,
      previousRevenue,
      previousExpenses,
      weeklyRevenue,
      weeklyExpenses,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: {
          ...revenueOrderFilter,
          placedAt: { gte: range.start, lt: range.end },
        },
        _sum: { total: true },
      }),
      this.prisma.costEntry.aggregate({
        where: { date: { gte: range.start, lt: range.end } },
        _sum: { amount: true },
      }),
      this.prisma.order.aggregate({
        where: {
          ...revenueOrderFilter,
          placedAt: { gte: previousRange.start, lt: previousRange.end },
        },
        _sum: { total: true },
      }),
      this.prisma.costEntry.aggregate({
        where: {
          date: { gte: previousRange.start, lt: previousRange.end },
        },
        _sum: { amount: true },
      }),
      this.prisma.$queryRaw<{ week: number; total: Prisma.Decimal }[]>`
          SELECT
            LEAST(4, FLOOR((EXTRACT(DAY FROM ("placedAt" + INTERVAL '6 hours')) - 1) / 7)::int + 1) AS week,
            COALESCE(SUM("total"), 0)::numeric AS total
          FROM "Order"
          WHERE ("status" = 'COMPLETED' OR "paymentStatus" = 'PAID')
            AND "placedAt" >= ${range.start} AND "placedAt" < ${range.end}
          GROUP BY week
        `,
      this.prisma.$queryRaw<{ week: number; total: Prisma.Decimal }[]>`
          SELECT
            LEAST(4, FLOOR((EXTRACT(DAY FROM ("date" + INTERVAL '6 hours')) - 1) / 7)::int + 1) AS week,
            COALESCE(SUM("amount"), 0)::numeric AS total
          FROM "CostEntry"
          WHERE "date" >= ${range.start} AND "date" < ${range.end}
          GROUP BY week
        `,
    ]);
    const weeklyRevenueMap = new Map(
      weeklyRevenue.map((row) => [row.week, row.total]),
    );
    const weeklyExpenseMap = new Map(
      weeklyExpenses.map((row) => [row.week, row.total]),
    );
    const weekly = [1, 2, 3, 4].map((week) => ({
      week,
      profit: (weeklyRevenueMap.get(week) ?? zero()).minus(
        weeklyExpenseMap.get(week) ?? zero(),
      ),
    }));
    const monthProfit = (revenue._sum.total ?? zero()).minus(
      expenses._sum.amount ?? zero(),
    );
    const previousProfit = (previousRevenue._sum.total ?? zero()).minus(
      previousExpenses._sum.amount ?? zero(),
    );
    const bestWeek = weekly.reduce(
      (best, current) =>
        current.profit.greaterThan(best.profit) ? current : best,
      weekly[0],
    );
    const lowestWeek = weekly.reduce(
      (lowest, current) =>
        current.profit.lessThan(lowest.profit) ? current : lowest,
      weekly[0],
    );
    const weeklyTotal = weekly.reduce(
      (sum, week) => sum.plus(week.profit),
      zero(),
    );

    return {
      monthProfit,
      changePercentVsPreviousMonth: percentChange(monthProfit, previousProfit),
      weekly,
      bestWeek,
      weeklyAverage: weeklyTotal.div(4).toDecimalPlaces(2),
      lowestWeek,
    };
  }

  private async getWorkerDashboard(query: DashboardQueryDTO) {
    const today = dateRange(
      query.date ? dhakaDateString(query.date) : dhakaDateString(),
    );
    const last7Start = new Date(
      today.start.getTime() - 6 * 24 * 60 * 60 * 1000,
    );
    const todayWhere = { placedAt: { gte: today.start, lt: today.end } };
    const [
      todayAll,
      counter,
      online,
      totalOrders,
      deliveredOrders,
      daily,
      recentCounterInvoices,
      recentOnlineOrders,
      lowStockAlerts,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: todayWhere,
        _sum: { total: true },
      }),
      this.prisma.order.aggregate({
        where: { ...todayWhere, channel: OrderChannel.COUNTER },
        _count: { _all: true },
        _sum: { total: true },
        _avg: { commissionAmount: true, commissionRate: true },
      }),
      this.prisma.order.aggregate({
        where: { ...todayWhere, channel: OrderChannel.WEBSITE },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.order.count(),
      this.prisma.order.count({
        where: { status: OrderStatus.COMPLETED },
      }),
      this.prisma.$queryRaw<
        { date: string; channel: OrderChannel; total: Prisma.Decimal }[]
      >`
          SELECT
            TO_CHAR(("placedAt" + INTERVAL '6 hours')::date, 'YYYY-MM-DD') AS date,
            "channel",
            COALESCE(SUM("total"), 0)::numeric AS total
          FROM "Order"
          WHERE "placedAt" >= ${last7Start} AND "placedAt" < ${today.end}
          GROUP BY date, "channel"
        `,
      this.prisma.order.findMany({
        where: { channel: OrderChannel.COUNTER },
        orderBy: { placedAt: 'desc' },
        take: 4,
        select: {
          id: true,
          orderNo: true,
          placedAt: true,
          total: true,
          commissionRate: true,
          commissionAmount: true,
          paymentStatus: true,
          shop: { select: { id: true, name: true, phone: true } },
          orderItems: {
            select: { quantity: true },
          },
        },
      }),
      this.prisma.order.findMany({
        where: { channel: OrderChannel.WEBSITE },
        orderBy: { placedAt: 'desc' },
        take: 4,
        select: {
          id: true,
          orderNo: true,
          placedAt: true,
          total: true,
          status: true,
          deliveryStatus: true,
          paymentStatus: true,
          shipName: true,
          shipPhone: true,
          orderItems: { select: { quantity: true } },
        },
      }),
      this.prisma.book.findMany({
        where: { availability: { in: ['LOW_STOCK', 'OUT_OF_STOCK'] } },
        orderBy: [{ availability: 'asc' }, { stock: 'asc' }],
        take: 10,
        select: {
          id: true,
          title: true,
          sku: true,
          stock: true,
          alertLimit: true,
          availability: true,
        },
      }),
    ]);

    const last7Days = Array.from({ length: 7 }, (_unused, index) => {
      const day = new Date(last7Start.getTime() + index * 24 * 60 * 60 * 1000);
      const date = dhakaDateString(day);
      return { date, counter: zero(), online: zero() };
    });
    const dayMap = new Map(last7Days.map((day) => [day.date, day]));
    for (const row of daily) {
      const day = dayMap.get(row.date);
      if (!day) continue;
      if (row.channel === OrderChannel.COUNTER) day.counter = row.total;
      else day.online = row.total;
    }
    const onlineTotal = online._sum.total ?? zero();
    const counterTotal = counter._sum.total ?? zero();
    const pendingDeliveries = await this.prisma.order.count({
      where: {
        ...todayWhere,
        channel: OrderChannel.WEBSITE,
        deliveryStatus: {
          in: [
            DeliveryStatus.NOT_DISPATCHED,
            DeliveryStatus.READY_TO_SHIP,
            DeliveryStatus.IN_TRANSIT,
          ],
        },
      },
    });
    return {
      todayTotalSales: todayAll._sum.total ?? zero(),
      counterSales: {
        memos: counter._count._all,
        total: counterTotal,
        avgCommission: counter._avg.commissionAmount ?? zero(),
        avgCommissionRate: counter._avg.commissionRate ?? zero(),
      },
      onlineSales: {
        orders: online._count._all,
        total: onlineTotal,
        pendingDeliveries,
      },
      totalOrders,
      successRate:
        totalOrders === 0
          ? 0
          : new Prisma.Decimal(deliveredOrders)
              .mul(100)
              .div(totalOrders)
              .toDecimalPlaces(2)
              .toNumber(),
      last7Days,
      recentCounterInvoices: recentCounterInvoices.map((order) => ({
        ...order,
        copies: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        itemCount: order.orderItems.length,
      })),
      recentOnlineOrders: recentOnlineOrders.map((order) => ({
        ...order,
        copies: order.orderItems.reduce((sum, item) => sum + item.quantity, 0),
        itemCount: order.orderItems.length,
      })),
      lowStockAlerts,
    };
  }

  private async getAuthorDashboard(userId: string) {
    const profile = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return {};
    const now = new Date();
    const recentYearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const [booksCount, royalties, ratings, latestReviews, monthlyRows] =
      await Promise.all([
        this.prisma.book.count({ where: { authorId: profile.id } }),
        this.prisma.royaltyEntry.aggregate({
          where: { authorId: profile.id },
          _sum: { copies: true, amount: true },
        }),
        this.prisma.review.aggregate({
          where: {
            status: ReviewStatus.APPROVED,
            book: { is: { authorId: profile.id } },
          },
          _avg: { rating: true },
        }),
        this.prisma.review.findMany({
          where: {
            status: ReviewStatus.APPROVED,
            book: { is: { authorId: profile.id } },
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            rating: true,
            title: true,
            comment: true,
            createdAt: true,
            book: { select: { id: true, title: true } },
            user: { select: { id: true, name: true } },
          },
        }),
        this.prisma.$queryRaw<{ month: number; copies: number }[]>`
          SELECT
            EXTRACT(MONTH FROM ("createdAt" + INTERVAL '6 hours'))::int AS month,
            COALESCE(SUM("copies"), 0)::int AS copies
          FROM "RoyaltyEntry"
          WHERE "authorId" = ${profile.id}
            AND "createdAt" >= ${recentYearStart}
          GROUP BY month
        `,
      ]);
    const payouts = await this.prisma.payoutRequest.aggregate({
      where: {
        authorId: profile.id,
        status: {
          in: [PayoutStatus.PENDING, PayoutStatus.APPROVED, PayoutStatus.PAID],
        },
      },
      _sum: { amount: true },
    });
    const totalCommission = royalties._sum.amount ?? zero();
    const monthMap = new Map(monthlyRows.map((row) => [row.month, row.copies]));
    return {
      booksCount,
      totalCopiesSold: royalties._sum.copies ?? 0,
      totalCommission,
      availableBalance: totalCommission.minus(payouts._sum.amount ?? zero()),
      avgRating: ratings._avg.rating ?? 0,
      latestReviews,
      monthlySales: Array.from({ length: 12 }, (_unused, index) => ({
        month: index + 1,
        copies: monthMap.get(index + 1) ?? 0,
      })),
    };
  }

  private async getReaderDashboard(userId: string) {
    const [
      activeOrders,
      deliveredOrders,
      wishlistCount,
      reviewsCount,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count({
        where: { customerId: userId, status: { in: activeOrderStatuses } },
      }),
      this.prisma.order.count({
        where: {
          customerId: userId,
          OR: [
            { status: OrderStatus.COMPLETED },
            { deliveryStatus: DeliveryStatus.DELIVERED },
          ],
        },
      }),
      this.prisma.wishlist.count({ where: { userId } }),
      this.prisma.review.count({ where: { userId } }),
      this.prisma.order.findMany({
        where: { customerId: userId },
        orderBy: { placedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          orderNo: true,
          placedAt: true,
          total: true,
          status: true,
          deliveryStatus: true,
          paymentStatus: true,
          orderItems: {
            select: {
              id: true,
              titleSnapshot: true,
              quantity: true,
              unitPrice: true,
              book: { select: { coverImageUrl: true, authorName: true } },
            },
          },
        },
      }),
    ]);
    return {
      activeOrders,
      deliveredOrders,
      wishlistCount,
      reviewsCount,
      recentOrders,
    };
  }
}
