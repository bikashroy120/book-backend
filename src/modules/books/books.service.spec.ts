import {
  Availability,
  BookStatus,
  Prisma,
  StockMovementType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { BooksService } from './books.service';

describe('BooksService', () => {
  it('computes sale price, slug, SKU, availability, and opening audit records server-side', async () => {
    let createdData:
      | {
          slug: string;
          sku: string;
          price: Prisma.Decimal;
          discountPercent: Prisma.Decimal;
          salePrice: Prisma.Decimal;
          availability: Availability;
          stock: number;
        }
      | undefined;
    const bookCreate = jest
      .fn()
      .mockImplementation(
        (input: {
          data: NonNullable<typeof createdData> & Record<string, unknown>;
        }) => {
          createdData = input.data;
          return Promise.resolve({ id: 'book-1' });
        },
      );
    let movementData:
      | {
          bookId: string;
          type: StockMovementType;
          quantity: number;
          balanceAfter: number;
          createdById: string | null;
          note: string | null;
        }
      | undefined;
    const stockMovementCreate = jest
      .fn()
      .mockImplementation(
        (input: { data: NonNullable<typeof movementData> }) => {
          movementData = input.data;
          return Promise.resolve({});
        },
      );
    let historyAction: string | undefined;
    const historyCreate = jest
      .fn()
      .mockImplementation((input: { data: { action: string } }) => {
        historyAction = input.data.action;
        return Promise.resolve({});
      });
    const transaction = {
      publisher: { findUnique: jest.fn().mockResolvedValue({ id: 'pub-1' }) },
      category: { findUnique: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
      authorProfile: { findUnique: jest.fn() },
      book: {
        findMany: jest.fn().mockResolvedValue([]),
        create: bookCreate,
      },
      stockMovement: { create: stockMovementCreate },
      bookEditHistory: { create: historyCreate },
    };
    const prismaTransaction = jest.fn(
      async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const prisma = {
      $transaction: prismaTransaction,
    } as unknown as PrismaService;
    const service = new BooksService(prisma);

    await service.create(
      { id: 'staff-1', email: 'staff@example.com', role: UserRole.ADMIN },
      {
        title: 'বাংলা বই',
        categoryId: 'cat-1',
        publisherId: 'pub-1',
        authorName: 'Writer Name',
        coverType: 'PAPERBACK',
        price: 99.99,
        discountPercent: 15,
        salePrice: 1,
        stock: 3,
        alertLimit: 5,
        status: BookStatus.PUBLISHED,
      },
    );

    expect(createdData).toBeDefined();
    expect(createdData?.slug).toMatch(/^book-[a-f0-9]{6}$/);
    expect(createdData?.sku).toBe('HP-0001');
    expect(createdData?.salePrice.toString()).toBe('84.99');
    expect(createdData?.availability).toBe(Availability.LOW_STOCK);
    expect(createdData?.stock).toBe(3);
    expect(movementData).toEqual({
      bookId: 'book-1',
      type: StockMovementType.PURCHASE,
      quantity: 3,
      balanceAfter: 3,
      createdById: 'staff-1',
      note: 'Opening stock',
    });
    expect(historyAction).toBe('CREATED');
    expect(prismaTransaction).toHaveBeenCalledTimes(1);
  });
});
