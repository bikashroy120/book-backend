import { BookStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { WishlistService } from './wishlist.service';

describe('WishlistService', () => {
  it('adds an existing wishlist item idempotently', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new WishlistService({
      book: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'book-1', status: BookStatus.PUBLISHED }),
      },
      wishlist: { createMany },
    } as unknown as PrismaService);

    await expect(service.add('reader-1', 'book-1')).resolves.toEqual({
      added: false,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ userId: 'reader-1', bookId: 'book-1' }],
      skipDuplicates: true,
    });
  });
});
