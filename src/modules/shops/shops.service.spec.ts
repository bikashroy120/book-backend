import { UserStatus, OrderChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateShopDTO } from './dto/create-shop.dto';
import { ShopsService } from './shops.service';

describe('ShopsService', () => {
  it('joins counter order totals from one grouped query and defaults empty totals to zero', async () => {
    const shopFindMany = jest.fn().mockResolvedValue([
      {
        id: 'shop-1',
        name: 'Bookshop',
        commissionRate: new Prisma.Decimal(30),
        status: UserStatus.ACTIVE,
      },
      {
        id: 'shop-2',
        name: 'New shop',
        commissionRate: new Prisma.Decimal(35),
        status: UserStatus.ACTIVE,
      },
    ]);
    const orderGroupBy = jest.fn().mockResolvedValue([
      {
        shopId: 'shop-1',
        _count: { _all: 4 },
        _sum: {
          total: new Prisma.Decimal('1200.50'),
          dueAmount: new Prisma.Decimal('200.50'),
        },
      },
    ]);
    const prisma = {
      shop: { findMany: shopFindMany, count: jest.fn().mockResolvedValue(2) },
      order: { groupBy: orderGroupBy },
    } as unknown as PrismaService;
    const service = new ShopsService(prisma);

    const result = await service.findAll({ page: 1, limit: 10 });

    expect(orderGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['shopId'],
        where: {
          channel: OrderChannel.COUNTER,
          shopId: { in: ['shop-1', 'shop-2'] },
        },
      }),
    );
    expect(result.data).toMatchObject([
      {
        id: 'shop-1',
        totalOrders: 4,
        totalOrderValue: new Prisma.Decimal('1200.50'),
        dueAmount: new Prisma.Decimal('200.50'),
      },
      {
        id: 'shop-2',
        totalOrders: 0,
        totalOrderValue: new Prisma.Decimal(0),
        dueAmount: new Prisma.Decimal(0),
      },
    ]);
  });

  it('filters due-only shops using grouped counter-order due totals', async () => {
    const shopFindMany = jest
      .fn()
      .mockResolvedValue([{ id: 'shop-due', name: 'Shop with dues' }]);
    const orderGroupBy = jest
      .fn()
      .mockResolvedValueOnce([{ shopId: 'shop-due', _count: { _all: 1 } }])
      .mockResolvedValueOnce([
        {
          shopId: 'shop-due',
          _count: { _all: 1 },
          _sum: {
            total: new Prisma.Decimal(300),
            dueAmount: new Prisma.Decimal(50),
          },
        },
      ]);
    const prisma = {
      shop: { findMany: shopFindMany, count: jest.fn().mockResolvedValue(1) },
      order: { groupBy: orderGroupBy },
    } as unknown as PrismaService;
    const service = new ShopsService(prisma);

    const result = await service.findAll({
      page: 1,
      limit: 10,
      dueOnly: true,
    });

    expect(shopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['shop-due'] } },
      }),
    );
    expect(result.data[0].dueAmount).toEqual(new Prisma.Decimal(50));
  });

  it('creates a shop even when its phone is duplicated and returns a warning', async () => {
    const created = {
      id: 'shop-1',
      name: 'Bookshop',
      commissionRate: new Prisma.Decimal(35),
    };
    const createShop = jest.fn().mockResolvedValue(created);
    const prisma = {
      shop: {
        findFirst: jest.fn().mockResolvedValue({ id: 'existing-shop' }),
        create: createShop,
      },
    } as unknown as PrismaService;
    const service = new ShopsService(prisma);

    const result = await service.create({
      name: 'Bookshop',
      ownerName: 'Owner',
      phone: '01712345678',
      commissionRate: 35,
    } satisfies CreateShopDTO);

    expect(result).toHaveProperty('data', created);
    expect('message' in result ? result.message : '').toContain('Warning');
    expect(createShop).toHaveBeenCalled();
  });

  it('suspends shops with orders rather than deleting them', async () => {
    const transaction = {
      shop: {
        findUnique: jest.fn().mockResolvedValue({ id: 'shop-1' }),
        update: jest.fn().mockResolvedValue({
          id: 'shop-1',
          status: UserStatus.SUSPENDED,
        }),
        delete: jest.fn(),
      },
      order: { count: jest.fn().mockResolvedValue(2) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ShopsService(prisma);

    await service.delete('shop-1');

    expect(transaction.shop.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: UserStatus.SUSPENDED },
      }),
    );
    expect(transaction.shop.delete).not.toHaveBeenCalled();
  });
});
