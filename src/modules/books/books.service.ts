import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Availability,
  BookStatus,
  OrderStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { randomToken } from '../../common/utils/crypto';
import { slugify } from '../../common/utils/slug';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../../core/database/prisma.service';
import type { BookHistoryQueryDTO } from './dto/book-history-query.dto';
import type { BooksQueryDTO } from './dto/books-query.dto';
import type { ChangeBookStatusDTO } from './dto/change-book-status.dto';
import type { CreateBookDTO } from './dto/create-book.dto';
import type { StoreBooksQueryDTO } from './dto/store-books-query.dto';
import type { UpdateBookDTO } from './dto/update-book.dto';
import { deriveAvailability } from './availability';

const bookDetailInclude = {
  bookImages: { orderBy: { sortOrder: 'asc' } },
  category: true,
  publisher: true,
  author: {
    select: {
      id: true,
      bio: true,
      isVerified: true,
      status: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.BookInclude;

const bookListSelect = {
  id: true,
  title: true,
  slug: true,
  sku: true,
  authorName: true,
  publisherId: true,
  categoryId: true,
  price: true,
  discountPercent: true,
  salePrice: true,
  stock: true,
  alertLimit: true,
  availability: true,
  status: true,
  coverImageUrl: true,
  publishedAt: true,
  createdAt: true,
  category: { select: { id: true, nameBn: true, nameEn: true, slug: true } },
  publisher: {
    select: { id: true, nameBn: true, nameEn: true, logoUrl: true },
  },
} satisfies Prisma.BookSelect;

const storeBookSelect = {
  id: true,
  title: true,
  slug: true,
  authorName: true,
  price: true,
  discountPercent: true,
  salePrice: true,
  availability: true,
  coverImageUrl: true,
  publishedAt: true,
  publisher: {
    select: { id: true, nameBn: true, nameEn: true, logoUrl: true },
  },
  category: { select: { id: true, nameBn: true, nameEn: true, slug: true } },
} satisfies Prisma.BookSelect;

type HistoricalValue = string | number | boolean | Date | Prisma.Decimal | null;
type BookChanges = {
  [field: string]: Prisma.InputJsonValue | null;
};

function isPrismaError(
  error: unknown,
  ...codes: string[]
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function calculateSalePrice(
  price: Prisma.Decimal,
  discountPercent: Prisma.Decimal,
): Prisma.Decimal {
  return price
    .minus(price.mul(discountPercent).div(100))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function historyValue(value: HistoricalValue): Prisma.InputJsonValue | null {
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function sameValue(left: HistoricalValue, right: HistoricalValue): boolean {
  if (left instanceof Prisma.Decimal && right instanceof Prisma.Decimal) {
    return left.equals(right);
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return left === right;
}

function addHistoryChange(
  changes: BookChanges,
  field: string,
  from: HistoricalValue,
  to: HistoricalValue,
): void {
  if (sameValue(from, to)) return;
  changes[field] = { from: historyValue(from), to: historyValue(to) };
}

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(editor: AuthUser, input: CreateBookDTO) {
    const now = new Date();
    const scheduledAt = this.resolveScheduledAt(
      input.status,
      input.scheduledAt,
      now,
    );
    const alertLimit = input.alertLimit ?? 5;
    const price = decimal(input.price);
    const discountPercent = decimal(input.discountPercent);
    const salePrice = calculateSalePrice(price, discountPercent);
    const imageUrls = input.imageUrls ?? [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            await this.assertReferences(transaction, {
              publisherId: input.publisherId,
              categoryId: input.categoryId,
              authorId: input.authorId,
            });
            const slug = await this.uniqueSlug(transaction, input.title);
            const sku = await this.generateNextSku(transaction);
            const created = await transaction.book.create({
              data: {
                title: input.title,
                slug,
                sku,
                description: input.description ?? null,
                publisherId: input.publisherId,
                categoryId: input.categoryId,
                authorId: input.authorId ?? null,
                authorName: input.authorName,
                totalPages: input.totalPages ?? null,
                coverType: input.coverType,
                publishYear: input.publishYear ?? null,
                wholesalePrice:
                  input.wholesalePrice === undefined
                    ? new Prisma.Decimal(0)
                    : decimal(input.wholesalePrice),
                price,
                discountPercent,
                salePrice,
                royaltyRate:
                  input.royaltyRate === undefined
                    ? new Prisma.Decimal(0)
                    : decimal(input.royaltyRate),
                stock: input.stock,
                alertLimit,
                availability: deriveAvailability(input.stock, alertLimit),
                coverImageUrl: input.coverImageUrl ?? null,
                samplePdfUrl: input.samplePdfUrl ?? null,
                status: input.status,
                scheduledAt,
                publishedAt: input.status === BookStatus.PUBLISHED ? now : null,
                bookImages: {
                  create: imageUrls.map((url, sortOrder) => ({
                    url,
                    sortOrder,
                  })),
                },
              },
              include: bookDetailInclude,
            });

            if (input.stock > 0) {
              await transaction.stockMovement.create({
                data: {
                  bookId: created.id,
                  type: StockMovementType.PURCHASE,
                  quantity: input.stock,
                  balanceAfter: input.stock,
                  note: 'Opening stock',
                  createdById: editor.id,
                },
              });
            }

            await transaction.bookEditHistory.create({
              data: {
                bookId: created.id,
                editorId: editor.id,
                action: 'CREATED',
                changes: {},
              },
            });

            return created;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isPrismaError(error, 'P2002', 'P2034') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002', 'P2034')) {
          throw new ConflictException(
            'Could not allocate a unique book slug or SKU; try again',
          );
        }
        if (isPrismaError(error, 'P2003')) {
          throw new NotFoundException(
            'The selected category, publisher, or author was not found',
          );
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not allocate a unique book slug or SKU; try again',
    );
  }

  async findAll(query: BooksQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where = this.adminWhere(query);
    const sqlConditions = this.adminSqlConditions(query);
    const [books, totalTitles, totals, lowStockCount, stockValueRows] =
      await Promise.all([
        this.prisma.book.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: bookListSelect,
        }),
        this.prisma.book.count({ where }),
        this.prisma.book.aggregate({
          where,
          _sum: { stock: true },
        }),
        this.prisma.book.count({
          where: { ...where, availability: Availability.LOW_STOCK },
        }),
        this.prisma.$queryRaw<{ stockValue: Prisma.Decimal }[]>`
          SELECT COALESCE(SUM(b."stock" * b."wholesalePrice"), 0)::numeric AS "stockValue"
          FROM "Book" AS b
          WHERE ${Prisma.join(sqlConditions, ' AND ')}
        `,
      ]);

    return {
      data: books,
      meta: {
        ...pageMeta(page, limit, totalTitles),
        totalTitles,
        totalStock: totals._sum.stock ?? 0,
        stockValue: stockValueRows[0]?.stockValue ?? new Prisma.Decimal(0),
        lowStockCount,
      },
    };
  }

  async getHistory(query: BookHistoryQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.BookEditHistoryWhereInput = query.bookId
      ? { bookId: query.bookId }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.bookEditHistory.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          bookId: true,
          action: true,
          changes: true,
          createdAt: true,
          editor: { select: { id: true, name: true } },
          book: { select: { title: true, slug: true, sku: true } },
        },
      }),
      this.prisma.bookEditHistory.count({ where }),
    ]);

    return { data, meta: pageMeta(page, limit, total) };
  }

  async getAuthorBooks(userId: string, query: BooksQueryDTO) {
    const author = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!author) {
      throw new NotFoundException('Author profile not found');
    }

    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.BookWhereInput = {
      authorId: author.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.publisherId ? { publisherId: query.publisherId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { authorName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.book.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: bookListSelect,
      }),
      this.prisma.book.count({ where }),
    ]);

    return { data, meta: pageMeta(page, limit, total) };
  }

  async getById(id: string) {
    const book = await this.prisma.book.findUnique({
      where: { id },
      include: bookDetailInclude,
    });
    if (!book) {
      throw new NotFoundException('Book not found');
    }
    return book;
  }

  async update(editor: AuthUser, id: string, input: UpdateBookDTO) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one book field is required');
    }

    return this.prisma.$transaction(
      async (transaction) => {
        const current = await transaction.book.findUnique({
          where: { id },
          include: { bookImages: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!current) {
          throw new NotFoundException('Book not found');
        }

        await this.assertReferences(transaction, {
          publisherId: input.publisherId,
          categoryId: input.categoryId,
          authorId: input.authorId,
        });

        const nextPrice =
          input.price === undefined ? current.price : decimal(input.price);
        const nextDiscount =
          input.discountPercent === undefined
            ? current.discountPercent
            : decimal(input.discountPercent);
        const nextSalePrice = calculateSalePrice(nextPrice, nextDiscount);
        const nextAlertLimit = input.alertLimit ?? current.alertLimit;
        const nextAvailability = deriveAvailability(
          current.stock,
          nextAlertLimit,
          current.availability,
        );
        const nextTitle = input.title ?? current.title;
        const nextSlug =
          nextTitle === current.title
            ? current.slug
            : await this.uniqueSlug(transaction, nextTitle, id);
        const nextImages =
          input.imageUrls ?? current.bookImages.map((image) => image.url);
        const oldImages = current.bookImages.map((image) => image.url);

        const changes: BookChanges = {};
        addHistoryChange(changes, 'title', current.title, nextTitle);
        addHistoryChange(changes, 'slug', current.slug, nextSlug);
        addHistoryChange(
          changes,
          'categoryId',
          current.categoryId,
          input.categoryId === undefined
            ? current.categoryId
            : input.categoryId,
        );
        addHistoryChange(
          changes,
          'publisherId',
          current.publisherId,
          input.publisherId ?? current.publisherId,
        );
        addHistoryChange(
          changes,
          'authorId',
          current.authorId,
          input.authorId === undefined ? current.authorId : input.authorId,
        );
        addHistoryChange(
          changes,
          'authorName',
          current.authorName,
          input.authorName ?? current.authorName,
        );
        addHistoryChange(
          changes,
          'totalPages',
          current.totalPages,
          input.totalPages === undefined
            ? current.totalPages
            : input.totalPages,
        );
        addHistoryChange(
          changes,
          'coverType',
          current.coverType,
          input.coverType ?? current.coverType,
        );
        addHistoryChange(
          changes,
          'publishYear',
          current.publishYear,
          input.publishYear === undefined
            ? current.publishYear
            : input.publishYear,
        );
        addHistoryChange(
          changes,
          'description',
          current.description,
          input.description === undefined
            ? current.description
            : input.description,
        );
        addHistoryChange(changes, 'price', current.price, nextPrice);
        addHistoryChange(
          changes,
          'discountPercent',
          current.discountPercent,
          nextDiscount,
        );
        addHistoryChange(
          changes,
          'salePrice',
          current.salePrice,
          nextSalePrice,
        );
        addHistoryChange(
          changes,
          'wholesalePrice',
          current.wholesalePrice,
          input.wholesalePrice === undefined
            ? current.wholesalePrice
            : decimal(input.wholesalePrice),
        );
        addHistoryChange(
          changes,
          'royaltyRate',
          current.royaltyRate,
          input.royaltyRate === undefined
            ? current.royaltyRate
            : decimal(input.royaltyRate),
        );
        addHistoryChange(
          changes,
          'alertLimit',
          current.alertLimit,
          nextAlertLimit,
        );
        addHistoryChange(
          changes,
          'availability',
          current.availability,
          nextAvailability,
        );
        addHistoryChange(
          changes,
          'coverImageUrl',
          current.coverImageUrl,
          input.coverImageUrl === undefined
            ? current.coverImageUrl
            : input.coverImageUrl,
        );
        addHistoryChange(
          changes,
          'samplePdfUrl',
          current.samplePdfUrl,
          input.samplePdfUrl === undefined
            ? current.samplePdfUrl
            : input.samplePdfUrl,
        );
        if (JSON.stringify(oldImages) !== JSON.stringify(nextImages)) {
          changes.imageUrls = {
            from: oldImages,
            to: nextImages,
          };
        }

        if (Object.keys(changes).length === 0) {
          return transaction.book.findUnique({
            where: { id },
            include: bookDetailInclude,
          });
        }

        const data: Prisma.BookUncheckedUpdateInput = {
          salePrice: nextSalePrice,
          availability: nextAvailability,
          slug: nextSlug,
        };
        if (input.title !== undefined) data.title = input.title;
        if (input.categoryId !== undefined) data.categoryId = input.categoryId;
        if (input.publisherId !== undefined)
          data.publisherId = input.publisherId;
        if (input.authorId !== undefined) data.authorId = input.authorId;
        if (input.authorName !== undefined) data.authorName = input.authorName;
        if (input.totalPages !== undefined) data.totalPages = input.totalPages;
        if (input.coverType !== undefined) data.coverType = input.coverType;
        if (input.publishYear !== undefined)
          data.publishYear = input.publishYear;
        if (input.description !== undefined)
          data.description = input.description;
        if (input.price !== undefined) data.price = nextPrice;
        if (input.discountPercent !== undefined)
          data.discountPercent = nextDiscount;
        if (input.wholesalePrice !== undefined)
          data.wholesalePrice = decimal(input.wholesalePrice);
        if (input.royaltyRate !== undefined)
          data.royaltyRate = decimal(input.royaltyRate);
        if (input.alertLimit !== undefined) data.alertLimit = input.alertLimit;
        if (input.coverImageUrl !== undefined)
          data.coverImageUrl = input.coverImageUrl;
        if (input.samplePdfUrl !== undefined)
          data.samplePdfUrl = input.samplePdfUrl;

        await transaction.book.update({ where: { id }, data });
        if (input.imageUrls !== undefined) {
          await transaction.bookImage.deleteMany({ where: { bookId: id } });
          if (input.imageUrls.length > 0) {
            await transaction.bookImage.createMany({
              data: input.imageUrls.map((url, sortOrder) => ({
                bookId: id,
                url,
                sortOrder,
              })),
            });
          }
        }

        const priceChanged =
          !current.price.equals(nextPrice) ||
          !current.discountPercent.equals(nextDiscount);
        await transaction.bookEditHistory.create({
          data: {
            bookId: id,
            editorId: editor.id,
            action: priceChanged ? 'PRICE_CHANGED' : 'UPDATED',
            changes,
          },
        });

        return transaction.book.findUnique({
          where: { id },
          include: bookDetailInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async changeStatus(editor: AuthUser, id: string, input: ChangeBookStatusDTO) {
    return this.setStatus(
      editor,
      id,
      input.status,
      input.scheduledAt,
      'UPDATED',
    );
  }

  async archive(editor: AuthUser, id: string) {
    return this.setStatus(
      editor,
      id,
      BookStatus.ARCHIVED,
      undefined,
      'DELETED',
    );
  }

  async findStoreBooks(query: StoreBooksQueryDTO) {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      decimal(query.minPrice).greaterThan(decimal(query.maxPrice))
    ) {
      throw new BadRequestException('minPrice cannot exceed maxPrice');
    }

    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where = this.storeWhere(query);
    const [total, books] = await Promise.all([
      this.prisma.book.count({ where }),
      query.sort === 'popular'
        ? this.findPopularBooks(query, skip, take)
        : this.prisma.book.findMany({
            where,
            skip,
            take,
            orderBy: this.storeOrderBy(query.sort),
            select: storeBookSelect,
          }),
    ]);

    return { data: books, meta: pageMeta(page, limit, total) };
  }

  async getStoreBook(slug: string) {
    const book = await this.prisma.book.findFirst({
      where: { slug, status: BookStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        authorName: true,
        totalPages: true,
        coverType: true,
        publishYear: true,
        price: true,
        discountPercent: true,
        salePrice: true,
        availability: true,
        coverImageUrl: true,
        samplePdfUrl: true,
        publishedAt: true,
        bookImages: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, url: true, sortOrder: true },
        },
        publisher: {
          select: { id: true, nameBn: true, nameEn: true, logoUrl: true },
        },
        category: {
          select: { id: true, nameBn: true, nameEn: true, slug: true },
        },
        author: {
          select: {
            id: true,
            bio: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
    });
    if (!book) {
      throw new NotFoundException('Book not found');
    }

    const relatedBooks = book.category
      ? await this.prisma.book.findMany({
          where: {
            categoryId: book.category.id,
            status: BookStatus.PUBLISHED,
            id: { not: book.id },
          },
          take: 6,
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
          select: storeBookSelect,
        })
      : [];

    return {
      ...book,
      relatedBooks,
      rating: { averageRating: null, reviewCount: 0 },
    };
  }

  private async setStatus(
    editor: AuthUser,
    id: string,
    status: BookStatus,
    scheduledAt: Date | undefined,
    action: string,
  ) {
    const now = new Date();
    const nextScheduledAt = this.resolveScheduledAt(status, scheduledAt, now);

    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.book.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
        },
      });
      if (!current) {
        throw new NotFoundException('Book not found');
      }

      const nextPublishedAt =
        status === BookStatus.PUBLISHED
          ? current.status === BookStatus.PUBLISHED
            ? (current.publishedAt ?? now)
            : now
          : status === BookStatus.ARCHIVED
            ? current.publishedAt
            : null;
      const changes: BookChanges = {};
      addHistoryChange(changes, 'status', current.status, status);
      addHistoryChange(
        changes,
        'scheduledAt',
        current.scheduledAt,
        nextScheduledAt,
      );
      addHistoryChange(
        changes,
        'publishedAt',
        current.publishedAt,
        nextPublishedAt,
      );

      if (Object.keys(changes).length > 0) {
        await transaction.book.update({
          where: { id },
          data: {
            status,
            scheduledAt: nextScheduledAt,
            publishedAt: nextPublishedAt,
          },
        });
        await transaction.bookEditHistory.create({
          data: { bookId: id, editorId: editor.id, action, changes },
        });
      }

      return transaction.book.findUnique({
        where: { id },
        include: bookDetailInclude,
      });
    });
  }

  private resolveScheduledAt(
    status: BookStatus,
    scheduledAt: Date | undefined,
    now: Date,
  ): Date | null {
    if (status !== BookStatus.SCHEDULED) return null;
    if (
      !scheduledAt ||
      !Number.isFinite(scheduledAt.getTime()) ||
      scheduledAt.getTime() <= now.getTime()
    ) {
      throw new BadRequestException(
        'A future scheduledAt is required for scheduled books',
      );
    }
    return scheduledAt;
  }

  private async assertReferences(
    transaction: Prisma.TransactionClient,
    references: {
      publisherId?: string;
      categoryId?: string | null;
      authorId?: string | null;
    },
  ): Promise<void> {
    const [publisher, category, author] = await Promise.all([
      references.publisherId
        ? transaction.publisher.findUnique({
            where: { id: references.publisherId },
            select: { id: true },
          })
        : Promise.resolve(true),
      references.categoryId
        ? transaction.category.findUnique({
            where: { id: references.categoryId },
            select: { id: true },
          })
        : Promise.resolve(true),
      references.authorId
        ? transaction.authorProfile.findUnique({
            where: { id: references.authorId },
            select: { id: true },
          })
        : Promise.resolve(true),
    ]);
    if (!publisher) throw new NotFoundException('Publisher not found');
    if (!category) throw new NotFoundException('Category not found');
    if (!author) throw new NotFoundException('Author profile not found');
  }

  private async uniqueSlug(
    transaction: Prisma.TransactionClient,
    title: string,
    excludeId?: string,
  ): Promise<string> {
    const baseSlug = slugify(title) || `book-${randomToken(3)}`;
    const collisionPrefix = baseSlug.slice(0, 20);
    const existing = await transaction.book.findMany({
      where: {
        slug: { startsWith: collisionPrefix },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { slug: true },
    });
    const slugs = new Set(existing.map((book) => book.slug));
    if (!slugs.has(baseSlug)) return baseSlug;

    for (let suffixNumber = 2; ; suffixNumber += 1) {
      const suffix = `-${suffixNumber}`;
      const prefix = baseSlug
        .slice(0, Math.max(1, 30 - suffix.length))
        .replace(/-+$/g, '');
      const candidate = `${prefix || 'book'}${suffix}`;
      if (!slugs.has(candidate)) return candidate;
    }
  }

  private async generateNextSku(
    transaction: Prisma.TransactionClient,
  ): Promise<string> {
    const books = await transaction.book.findMany({
      where: { sku: { startsWith: 'HP-' } },
      select: { sku: true },
    });
    const maxSequence = books.reduce((max, book) => {
      const match = /^HP-(\d+)$/.exec(book.sku ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    return `HP-${String(maxSequence + 1).padStart(4, '0')}`;
  }

  private adminWhere(query: BooksQueryDTO): Prisma.BookWhereInput {
    return {
      ...(query.publisherId ? { publisherId: query.publisherId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { authorName: { contains: query.search, mode: 'insensitive' } },
              {
                category: {
                  is: {
                    OR: [
                      {
                        nameBn: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        nameEn: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private adminSqlConditions(query: BooksQueryDTO): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.publisherId) {
      conditions.push(Prisma.sql`b."publisherId" = ${query.publisherId}`);
    }
    if (query.categoryId) {
      conditions.push(Prisma.sql`b."categoryId" = ${query.categoryId}`);
    }
    if (query.status) {
      conditions.push(Prisma.sql`b."status" = ${query.status}`);
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(Prisma.sql`(
        b."title" ILIKE ${pattern}
        OR b."authorName" ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM "Category" AS c
          WHERE c."id" = b."categoryId"
            AND (c."nameBn" ILIKE ${pattern} OR c."nameEn" ILIKE ${pattern})
        )
      )`);
    }
    return conditions;
  }

  private storeWhere(query: StoreBooksQueryDTO): Prisma.BookWhereInput {
    const minPrice =
      query.minPrice === undefined ? undefined : decimal(query.minPrice);
    const maxPrice =
      query.maxPrice === undefined ? undefined : decimal(query.maxPrice);
    return {
      status: BookStatus.PUBLISHED,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.publisherId ? { publisherId: query.publisherId } : {}),
      ...(minPrice || maxPrice
        ? {
            salePrice: {
              ...(minPrice ? { gte: minPrice } : {}),
              ...(maxPrice ? { lte: maxPrice } : {}),
            },
          }
        : {}),
      ...(query.inStock === undefined
        ? {}
        : query.inStock
          ? { stock: { gt: 0 } }
          : { stock: { lte: 0 } }),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { authorName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private storeSqlConditions(query: StoreBooksQueryDTO): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`b."status" = ${BookStatus.PUBLISHED}`,
    ];
    if (query.categoryId) {
      conditions.push(Prisma.sql`b."categoryId" = ${query.categoryId}`);
    }
    if (query.publisherId) {
      conditions.push(Prisma.sql`b."publisherId" = ${query.publisherId}`);
    }
    if (query.minPrice !== undefined) {
      conditions.push(Prisma.sql`b."salePrice" >= ${decimal(query.minPrice)}`);
    }
    if (query.maxPrice !== undefined) {
      conditions.push(Prisma.sql`b."salePrice" <= ${decimal(query.maxPrice)}`);
    }
    if (query.inStock === true) {
      conditions.push(Prisma.sql`b."stock" > 0`);
    } else if (query.inStock === false) {
      conditions.push(Prisma.sql`b."stock" <= 0`);
    }
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(
        Prisma.sql`(b."title" ILIKE ${pattern} OR b."authorName" ILIKE ${pattern})`,
      );
    }
    return conditions;
  }

  private storeOrderBy(
    sort: StoreBooksQueryDTO['sort'],
  ): Prisma.BookOrderByWithRelationInput[] {
    if (sort === 'price_asc')
      return [{ salePrice: 'asc' }, { createdAt: 'desc' }];
    if (sort === 'price_desc')
      return [{ salePrice: 'desc' }, { createdAt: 'desc' }];
    return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
  }

  private async findPopularBooks(
    query: StoreBooksQueryDTO,
    skip: number,
    take: number,
  ) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT b."id"
      FROM "Book" AS b
      LEFT JOIN "OrderItem" AS oi ON oi."bookId" = b."id"
      LEFT JOIN "Order" AS o
        ON o."id" = oi."orderId" AND o."status" = ${OrderStatus.COMPLETED}
      WHERE ${Prisma.join(this.storeSqlConditions(query), ' AND ')}
      GROUP BY b."id", b."createdAt"
      ORDER BY COALESCE(
        SUM(CASE WHEN o."id" IS NOT NULL THEN oi."quantity" ELSE 0 END),
        0
      ) DESC, b."createdAt" DESC, b."id" ASC
      LIMIT ${take} OFFSET ${skip}
    `;
    if (rows.length === 0) return [];

    const books = await this.prisma.book.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      select: storeBookSelect,
    });
    const booksById = new Map(books.map((book) => [book.id, book]));
    return rows.flatMap((row) => {
      const book = booksById.get(row.id);
      return book ? [book] : [];
    });
  }
}
