import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import {
  ApprovalStatus,
  OrderStatus,
  PayoutStatus,
  Prisma,
  RoyaltyStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { RoyaltyService } from './royalty.service';

describe('RoyaltyService', () => {
  it('enforces the configured minimum and available payout balance', async () => {
    const payoutCreate = jest.fn().mockResolvedValue({
      id: 'payout-1',
      code: 'PR-1001',
      amount: new Prisma.Decimal(500),
      status: PayoutStatus.PENDING,
    });
    const transaction = {
      authorProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'author-1',
          status: ApprovalStatus.APPROVED,
        }),
      },
      setting: { findUnique: jest.fn().mockResolvedValue(null) },
      royaltyEntry: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: new Prisma.Decimal(400) } }),
      },
      payoutRequest: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: new Prisma.Decimal(0) } }),
        findMany: jest.fn().mockResolvedValue([]),
        create: payoutCreate,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new RoyaltyService(prisma, {} as EventEmitter2);

    await expect(
      service.requestPayout('author-user', {
        amount: 499,
        method: 'BKASH',
        accountNo: '01712345678',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.requestPayout('author-user', {
        amount: 500,
        method: 'BKASH',
        accountNo: '01712345678',
      }),
    ).rejects.toThrow('Payout amount exceeds the available balance');
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('creates royalty snapshots idempotently for completed order items', async () => {
    const transaction = {
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: OrderStatus.COMPLETED }),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'item-1',
            bookId: 'book-1',
            unitPrice: new Prisma.Decimal('25.00'),
            quantity: 2,
            book: {
              authorId: 'author-1',
              royaltyRate: new Prisma.Decimal('10'),
            },
          },
        ]),
      },
      royaltyEntry: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new RoyaltyService(prisma, {} as EventEmitter2);

    await service.handleOrderCompleted({ orderId: 'order-1' });
    await service.handleOrderCompleted({ orderId: 'order-1' });

    expect(transaction.royaltyEntry.createMany).toHaveBeenCalledTimes(2);
    expect(transaction.royaltyEntry.createMany).toHaveBeenCalledWith({
      data: [
        {
          authorId: 'author-1',
          bookId: 'book-1',
          orderItemId: 'item-1',
          copies: 2,
          ratePerCopy: new Prisma.Decimal('2.50'),
          rate: new Prisma.Decimal('10'),
          amount: new Prisma.Decimal('5.00'),
          status: RoyaltyStatus.PAYABLE,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('removes royalty entries when an order is reversed', async () => {
    const transaction = {
      royaltyEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new RoyaltyService(prisma, {} as EventEmitter2);

    await service.handleOrderReversed({ orderId: 'order-1' });

    expect(transaction.royaltyEntry.deleteMany).toHaveBeenCalledWith({
      where: { orderItem: { is: { orderId: 'order-1' } } },
    });
  });

  it('calculates author balances from earned and active payout amounts', async () => {
    const prisma = {
      royaltyEntry: {
        groupBy: jest.fn().mockResolvedValue([
          {
            authorId: 'author-1',
            _sum: { amount: new Prisma.Decimal('120.00') },
          },
        ]),
      },
      payoutRequest: {
        groupBy: jest.fn().mockResolvedValue([
          {
            authorId: 'author-1',
            status: PayoutStatus.PAID,
            _sum: { amount: new Prisma.Decimal('30.00') },
          },
          {
            authorId: 'author-1',
            status: PayoutStatus.APPROVED,
            _sum: { amount: new Prisma.Decimal('20.00') },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new RoyaltyService(prisma, {} as EventEmitter2);

    const balances = await service.getAuthorBalances([
      'author-1',
      'author-without-activity',
    ]);

    expect(balances.get('author-1')).toEqual({
      earned: new Prisma.Decimal('120.00'),
      paid: new Prisma.Decimal('30.00'),
      due: new Prisma.Decimal('90.00'),
      pendingWithdraw: new Prisma.Decimal('20.00'),
    });
    expect(balances.get('author-without-activity')).toEqual({
      earned: new Prisma.Decimal(0),
      paid: new Prisma.Decimal(0),
      due: new Prisma.Decimal(0),
      pendingWithdraw: new Prisma.Decimal(0),
    });
  });

  it('emits payout.paid only after the status transaction commits', async () => {
    type PayoutUpdateArgs = {
      where: { id: string; status: PayoutStatus };
      data: {
        status: PayoutStatus;
        adminNote?: string;
        processedById: string;
        processedAt: Date;
      };
    };
    let committed = false;
    let updateArgs: PayoutUpdateArgs | undefined;
    const payout = {
      id: 'payout-1',
      code: 'PR-1001',
      amount: new Prisma.Decimal('500.00'),
      status: PayoutStatus.PAID,
      adminNote: null,
      requestedAt: new Date('2026-01-01T00:00:00.000Z'),
      processedAt: new Date('2026-01-02T00:00:00.000Z'),
      author: {
        id: 'author-1',
        user: { id: 'user-1', name: 'Author', email: 'author@example.com' },
      },
      processedBy: { id: 'admin-1', name: 'Admin' },
    };
    const transaction = {
      payoutRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payout-1',
          code: 'PR-1001',
          amount: payout.amount,
          authorId: 'author-1',
          status: PayoutStatus.APPROVED,
        }),
        updateMany: jest.fn().mockImplementation((args: PayoutUpdateArgs) => {
          updateArgs = args;
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(payout),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) => {
          const result = await callback(transaction);
          committed = true;
          return result;
        },
      ),
    } as unknown as PrismaService;
    let emittedPayload: Record<string, unknown> | undefined;
    const emit = jest.fn((_event: string, payload: Record<string, unknown>) => {
      expect(committed).toBe(true);
      emittedPayload = payload;
    });
    const eventEmitter = { emit } as unknown as EventEmitter2;
    const service = new RoyaltyService(prisma, eventEmitter);

    await service.updatePayout('admin-1', 'payout-1', {
      status: PayoutStatus.PAID,
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emittedPayload).toMatchObject({
      payoutId: 'payout-1',
      authorId: 'author-1',
      amount: payout.amount,
      payoutCode: payout.code,
      createdById: 'admin-1',
    });
    expect(emittedPayload?.paidAt).toBeInstanceOf(Date);
    expect(updateArgs).toMatchObject({
      where: { id: 'payout-1', status: PayoutStatus.APPROVED },
      data: { status: PayoutStatus.PAID, processedById: 'admin-1' },
    });
    expect(updateArgs?.data.processedAt).toBeInstanceOf(Date);
  });

  it('requires an approved author profile before payout actions', async () => {
    const prisma = {
      authorProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'author-1',
          status: ApprovalStatus.PENDING,
        }),
      },
    } as unknown as PrismaService;
    const service = new RoyaltyService(prisma, {} as EventEmitter2);

    await expect(service.getAnalytics('user-1')).rejects.toThrow(
      'An approved author profile is required',
    );
  });
});
