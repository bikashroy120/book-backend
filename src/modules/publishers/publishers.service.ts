import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import type { CreatePublisherDTO } from './dto/create-publisher.dto';
import type { PublisherBooksQueryDTO } from './dto/publisher-books-query.dto';
import type { PublishersQueryDTO } from './dto/publishers-query.dto';
import type { UpdatePublisherDTO } from './dto/update-publisher.dto';

const publisherSelect = {
  id: true,
  nameBn: true,
  nameEn: true,
  code: true,
  phone: true,
  email: true,
  address: true,
  website: true,
  logoUrl: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function isPrismaError(
  error: unknown,
  ...codes: string[]
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

@Injectable()
export class PublishersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PublishersQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.PublisherWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { nameBn: { contains: query.search, mode: 'insensitive' } },
              { nameEn: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [publishers, total] = await Promise.all([
      this.prisma.publisher.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          nameBn: true,
          nameEn: true,
          logoUrl: true,
          status: true,
          _count: { select: { books: true } },
        },
      }),
      this.prisma.publisher.count({ where }),
    ]);

    return {
      data: publishers.map(({ _count, ...publisher }) => ({
        ...publisher,
        bookCount: _count.books,
      })),
      meta: pageMeta(page, limit, total),
    };
  }

  async getSummary() {
    const [totalPublishers, bookTotals] = await Promise.all([
      this.prisma.publisher.count(),
      this.prisma.book.aggregate({
        _count: { _all: true },
        _sum: { stock: true },
      }),
    ]);

    return {
      totalPublishers,
      totalTitles: bookTotals._count._all,
      totalCopies: bookTotals._sum.stock ?? 0,
    };
  }

  async getById(id: string, query: PublisherBooksQueryDTO) {
    const publisher = await this.prisma.publisher.findUnique({
      where: { id },
      select: publisherSelect,
    });
    if (!publisher) {
      throw new NotFoundException('Publisher not found');
    }

    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.BookWhereInput = {
      publisherId: id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { authorName: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [totals, stockValueRows, books, total] = await Promise.all([
      this.prisma.book.aggregate({
        where: { publisherId: id },
        _count: { _all: true },
        _sum: { stock: true },
      }),
      this.prisma.$queryRaw<{ stockValue: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM("stock" * "price"), 0)::numeric AS "stockValue"
        FROM "Book"
        WHERE "publisherId" = ${id}
      `,
      this.prisma.book.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          sku: true,
          authorName: true,
          stock: true,
          price: true,
          status: true,
          coverImageUrl: true,
          publishedAt: true,
        },
      }),
      this.prisma.book.count({ where }),
    ]);

    return {
      ...publisher,
      stats: {
        titles: totals._count._all,
        copiesInStock: totals._sum.stock ?? 0,
        stockValue: stockValueRows[0]?.stockValue ?? new Prisma.Decimal(0),
      },
      books: { data: books, meta: pageMeta(page, limit, total) },
    };
  }

  async create(input: CreatePublisherDTO) {
    const requestedCode = input.code?.trim() || null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const code =
              requestedCode ?? (await this.generateNextCode(transaction));
            const existing = await transaction.publisher.findUnique({
              where: { code },
              select: { id: true },
            });
            if (existing) {
              throw new ConflictException('Publisher code is already in use');
            }

            return transaction.publisher.create({
              data: {
                nameBn: input.nameBn,
                nameEn: input.nameEn,
                code,
                phone: input.phone,
                email: input.email,
                address: input.address,
                website: input.website,
                logoUrl: input.logoUrl,
                description: input.description,
                ...(input.status ? { status: input.status } : {}),
              },
              select: publisherSelect,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        if (isPrismaError(error, 'P2002') && requestedCode) {
          throw new ConflictException('Publisher code is already in use');
        }
        if (
          requestedCode === null &&
          isPrismaError(error, 'P2002', 'P2034') &&
          attempt < 4
        ) {
          continue;
        }
        if (isPrismaError(error, 'P2002', 'P2034')) {
          throw new ConflictException(
            'Could not allocate a unique publisher code; try again',
          );
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not allocate a unique publisher code; try again',
    );
  }

  async update(id: string, input: UpdatePublisherDTO) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one publisher field is required');
    }

    const data: Prisma.PublisherUpdateInput = {};
    if (input.nameBn !== undefined) data.nameBn = input.nameBn;
    if (input.nameEn !== undefined) data.nameEn = input.nameEn;
    if (input.code !== undefined) data.code = input.code?.trim() || null;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email;
    if (input.address !== undefined) data.address = input.address;
    if (input.website !== undefined) data.website = input.website;
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
    if (input.description !== undefined) data.description = input.description;
    if (input.status !== undefined) data.status = input.status;

    try {
      return await this.prisma.publisher.update({
        where: { id },
        data,
        select: publisherSelect,
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('Publisher code is already in use');
      }
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Publisher not found');
      }
      throw error;
    }
  }

  async delete(id: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const publisher = await transaction.publisher.findUnique({
          where: { id },
          select: { id: true, _count: { select: { books: true } } },
        });
        if (!publisher) {
          throw new NotFoundException('Publisher not found');
        }
        if (publisher._count.books > 0) {
          throw new ConflictException(
            'Publisher has books; set its status to SUSPENDED instead',
          );
        }

        return transaction.publisher.delete({
          where: { id },
          select: { id: true },
        });
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isPrismaError(error, 'P2003')) {
        throw new ConflictException(
          'Publisher has books; set its status to SUSPENDED instead',
        );
      }
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Publisher not found');
      }
      throw error;
    }
  }

  private async generateNextCode(
    transaction: Prisma.TransactionClient,
  ): Promise<string> {
    const publishers = await transaction.publisher.findMany({
      where: { code: { startsWith: 'PUB-' } },
      select: { code: true },
    });
    const maxSequence = publishers.reduce((max, publisher) => {
      const match = /^PUB-(\d+)$/.exec(publisher.code ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return `PUB-${String(maxSequence + 1).padStart(3, '0')}`;
  }
}
