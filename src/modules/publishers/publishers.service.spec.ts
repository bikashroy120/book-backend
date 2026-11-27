import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { PublishersService } from './publishers.service';

describe('PublishersService', () => {
  it('generates the next padded publisher code when none is supplied', async () => {
    let createdCode: string | null | undefined;
    const createPublisher = jest
      .fn()
      .mockImplementation(
        (input: { data: { code: string | null; nameBn: string } }) => {
          createdCode = input.data.code;
          return Promise.resolve(input.data);
        },
      );
    const publisher = {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { code: 'PUB-009' },
          { code: 'PUB-099' },
          { code: 'CUSTOM' },
        ]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: createPublisher,
    };
    const transaction = { publisher };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new PublishersService(prisma);

    await service.create({ nameBn: 'প্রকাশক' });

    expect(createdCode).toBe('PUB-100');
  });

  it('returns a conflict for a duplicate explicitly supplied code', async () => {
    const publisher = {
      findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
      create: jest.fn(),
    };
    const transaction = { publisher };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new PublishersService(prisma);

    await expect(
      service.create({ nameBn: 'প্রকাশক', code: 'PUB-001' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(publisher.create).not.toHaveBeenCalled();
  });

  it('returns publisher stock valuation as a Decimal alongside paginated books', async () => {
    const bookFindMany = jest.fn().mockResolvedValue([]);
    const publisher = {
      id: 'publisher-1',
      nameBn: 'প্রকাশক',
      nameEn: 'Publisher',
      code: 'PUB-001',
      phone: null,
      email: null,
      address: null,
      website: null,
      logoUrl: null,
      description: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      publisher: {
        findUnique: jest.fn().mockResolvedValue(publisher),
      },
      book: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 2 },
          _sum: { stock: 5 },
        }),
        findMany: bookFindMany,
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ stockValue: new Prisma.Decimal('1234.56') }]),
    } as unknown as PrismaService;
    const service = new PublishersService(prisma);

    const result = await service.getById('publisher-1', {
      page: 1,
      limit: 10,
    });

    expect(result.stats).toEqual({
      titles: 2,
      copiesInStock: 5,
      stockValue: new Prisma.Decimal('1234.56'),
    });
    expect(result.books.meta.total).toBe(0);
    expect(bookFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { publisherId: 'publisher-1' } }),
    );
  });

  it('maps related book counts to the publisher list contract', async () => {
    const prisma = {
      publisher: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'publisher-1',
            nameBn: 'প্রকাশক',
            nameEn: 'Publisher',
            logoUrl: null,
            status: 'ACTIVE',
            _count: { books: 3 },
          },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const service = new PublishersService(prisma);

    const result = await service.findAll({ page: 1, limit: 10 });

    expect(result.data[0]).toMatchObject({
      id: 'publisher-1',
      bookCount: 3,
    });
    expect(result.meta.total).toBe(1);
  });
});
