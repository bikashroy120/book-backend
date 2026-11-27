import { ForbiddenException } from '@nestjs/common';
import { BookStatus, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const input = {
    bookId: 'book-1',
    rating: 5,
    title: 'Excellent',
    comment: 'A thoughtful and enjoyable read.',
  };

  it('requires a delivered or completed customer order before review creation', async () => {
    const reviewCreate = jest.fn();
    const service = new ReviewsService({
      book: {
        findUnique: jest.fn().mockResolvedValue({ id: 'book-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'book-1' }),
      },
      orderItem: { findFirst: jest.fn().mockResolvedValue(null) },
      review: { create: reviewCreate },
    } as unknown as PrismaService);

    await expect(service.create('reader-1', input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  it('creates verified reviews only after finding a qualifying completed order', async () => {
    const reviewCreate = jest.fn().mockResolvedValue({
      id: 'review-1',
      status: ReviewStatus.PENDING,
      isVerifiedPurchase: true,
    });
    const orderItemFind = jest.fn().mockResolvedValue({ id: 'item-1' });
    const service = new ReviewsService({
      book: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'book-1', status: BookStatus.PUBLISHED }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'book-1', status: BookStatus.PUBLISHED }),
      },
      orderItem: { findFirst: orderItemFind },
      review: { create: reviewCreate },
    } as unknown as PrismaService);

    await expect(service.create('reader-1', input)).resolves.toMatchObject({
      status: ReviewStatus.PENDING,
      isVerifiedPurchase: true,
    });
    expect(orderItemFind).toHaveBeenCalledTimes(1);
  });
});
