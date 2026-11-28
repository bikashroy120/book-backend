import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../../core/database/prisma.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  it('caches the admin dashboard for 60 seconds', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-28T12:00:00.000Z'));
    const bookCount = jest.fn().mockResolvedValue(5);
    const groupBy = jest.fn().mockResolvedValue([]);
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = {
      book: { count: bookCount, findMany: jest.fn().mockResolvedValue([]) },
      user: { count: jest.fn().mockResolvedValue(10) },
      order: {
        count: jest.fn().mockResolvedValue(12),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { total: new Prisma.Decimal('100.00') },
        }),
      },
      costEntry: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amount: new Prisma.Decimal('20.00') },
        }),
      },
      orderItem: { groupBy },
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const service = new DashboardService(prisma);
    const admin: AuthUser = {
      id: 'admin-1',
      email: 'admin@example.test',
      role: UserRole.ADMIN,
    };

    try {
      await service.getDashboard(admin, { month: '2026-11' });
      await service.getDashboard(admin, { month: '2026-11' });
      expect(bookCount).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60_001);
      await service.getDashboard(admin, { month: '2026-11' });
      expect(bookCount).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns reader dashboard counts and the most recent orders', async () => {
    const prisma = {
      order: {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(5),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'order-1',
            orderNo: 'ORD-1',
            total: new Prisma.Decimal('120.00'),
          },
        ]),
      },
      wishlist: { count: jest.fn().mockResolvedValue(3) },
      review: { count: jest.fn().mockResolvedValue(4) },
    } as unknown as PrismaService;
    const service = new DashboardService(prisma);
    const user: AuthUser = {
      id: 'reader-1',
      email: 'reader@example.test',
      role: UserRole.USER,
    };

    await expect(service.getDashboard(user, {})).resolves.toMatchObject({
      activeOrders: 2,
      deliveredOrders: 5,
      wishlistCount: 3,
      reviewsCount: 4,
      recentOrders: [{ id: 'order-1' }],
    });
  });
});
