import { Injectable, NotFoundException } from '@nestjs/common';
import { BookStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(userId: string) {
    return this.prisma.wishlist.findMany({
      where: { userId, book: { status: BookStatus.PUBLISHED } },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        book: {
          select: {
            id: true,
            title: true,
            slug: true,
            authorName: true,
            price: true,
            salePrice: true,
            availability: true,
            coverImageUrl: true,
          },
        },
      },
    });
  }

  async add(userId: string, bookId: string) {
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, status: BookStatus.PUBLISHED },
      select: { id: true },
    });
    if (!book) throw new NotFoundException('Book not found');

    const result = await this.prisma.wishlist.createMany({
      data: [{ userId, bookId }],
      skipDuplicates: true,
    });
    return { added: result.count === 1 };
  }

  async remove(userId: string, bookId: string) {
    const result = await this.prisma.wishlist.deleteMany({
      where: { userId, bookId },
    });
    return { removed: result.count > 0 };
  }
}
