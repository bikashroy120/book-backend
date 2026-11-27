import { BadRequestException } from '@nestjs/common';
import {
  CostCategory,
  Prisma,
  ProductionCostType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { CostsService } from './costs.service';

describe('CostsService', () => {
  it('summarizes monthly costs using Decimal values and compares to prior month', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        category: CostCategory.BOOK_PRODUCTION,
        _sum: { amount: new Prisma.Decimal('100.00') },
      },
      {
        category: CostCategory.AUTHOR_COMMISSION,
        _sum: { amount: new Prisma.Decimal('50.00') },
      },
      {
        category: CostCategory.EMPLOYEE_SALARY,
        _sum: { amount: new Prisma.Decimal('20.00') },
      },
      {
        category: CostCategory.MARKETING,
        _sum: { amount: new Prisma.Decimal('30.00') },
      },
    ]);
    const prisma = {
      costEntry: {
        groupBy,
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amount: new Prisma.Decimal('100.00') },
        }),
      },
    } as unknown as PrismaService;
    const service = new CostsService(prisma);

    await expect(service.getSummary({ month: '2026-11' })).resolves.toEqual({
      bookProduction: new Prisma.Decimal('100.00'),
      authorCommission: new Prisma.Decimal('50.00'),
      employeeSalary: new Prisma.Decimal('20.00'),
      marketing: new Prisma.Decimal('30.00'),
      grandTotal: new Prisma.Decimal('200.00'),
      changePercentVsPreviousMonth: 100,
    });

    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lt: new Date('2026-12-01T00:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('groups book production entries and returns the month-wide total', async () => {
    const book = {
      id: 'book-1',
      title: 'Book One',
      sku: 'HP-0001',
      coverImageUrl: 'https://example.test/cover.jpg',
    };
    const prisma = {
      costEntry: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cost-1',
            productionType: ProductionCostType.PRINTING,
            title: null,
            amount: new Prisma.Decimal('10.00'),
            date: new Date('2026-11-10T00:00:00.000Z'),
            note: null,
            createdAt: new Date('2026-11-10T00:00:00.000Z'),
            bookId: 'book-1',
            book,
          },
          {
            id: 'cost-2',
            productionType: ProductionCostType.PAPER,
            title: null,
            amount: new Prisma.Decimal('20.75'),
            date: new Date('2026-11-11T00:00:00.000Z'),
            note: 'Paper order',
            createdAt: new Date('2026-11-11T00:00:00.000Z'),
            bookId: 'book-1',
            book,
          },
        ]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { amount: new Prisma.Decimal('200.00') },
        }),
      },
    } as unknown as PrismaService;
    const service = new CostsService(prisma);

    const result = await service.getBookCosts({ month: '2026-11' });

    expect(result.monthTotal).toEqual(new Prisma.Decimal('200.00'));
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      book,
      total: new Prisma.Decimal('30.75'),
      byType: {
        [ProductionCostType.PRINTING]: new Prisma.Decimal('10.00'),
        [ProductionCostType.PAPER]: new Prisma.Decimal('20.75'),
      },
      entries: [{ id: 'cost-1' }, { id: 'cost-2' }],
    });
  });

  it('rejects salary costs for users outside WORKER and ADMIN roles', async () => {
    const create = jest.fn();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          role: UserRole.SUPER_ADMIN,
        }),
      },
      costEntry: { create },
    } as unknown as PrismaService;
    const service = new CostsService(prisma);

    await expect(
      service.createSalaryCost('admin-1', {
        employeeId: 'user-1',
        amount: 100,
        date: new Date('2026-11-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('records payout costs with a unique payout reference for duplicate events', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      costEntry: { createMany },
    } as unknown as PrismaService;
    const service = new CostsService(prisma);
    const event = {
      payoutId: 'payout-1',
      amount: new Prisma.Decimal('500.00'),
      payoutCode: 'PR-1001',
      paidAt: new Date('2026-11-20T08:30:00.000Z'),
      createdById: 'admin-1',
    };

    await service.handlePayoutPaid(event);
    await service.handlePayoutPaid(event);

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          payoutId: 'payout-1',
          category: CostCategory.AUTHOR_COMMISSION,
          amount: new Prisma.Decimal('500.00'),
          title: 'Royalty payout PR-1001',
          date: event.paidAt,
          createdById: 'admin-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('exports cost data as UTF-8 CSV with a BOM', async () => {
    const prisma = {
      costEntry: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const file = await new CostsService(prisma).exportCsv({ month: '2026-11' });
    const contents = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = file.getStream();
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });

    expect(contents.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});
