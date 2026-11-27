import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Availability, Prisma, StockMovementType } from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { deriveAvailability } from '../books/availability';
import type { CreateStockMovementDTO } from './dto/create-stock-movement.dto';
import type { StockHistoryQueryDTO } from './dto/stock-history-query.dto';
import type { StockQueryDTO } from './dto/stock-query.dto';
import type { UpdateAlertLimitDTO } from './dto/update-alert-limit.dto';

const stockBookSelect = {
  id: true,
  title: true,
  authorName: true,
  coverImageUrl: true,
  sku: true,
  price: true,
  stock: true,
  alertLimit: true,
  availability: true,
  category: { select: { id: true, nameBn: true, nameEn: true } },
  stockMovements: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true },
  },
} satisfies Prisma.BookSelect;

export type ApplyStockMovementInput = {
  bookId: string;
  type: StockMovementType;
  quantity: number;
  direction?: 'in' | 'out';
  note?: string | null;
  orderId?: string | null;
  userId?: string | null;
};

function stockValue(stock: number, price: Prisma.Decimal): Prisma.Decimal {
  return price.mul(stock).toDecimalPlaces(2);
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: StockQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const baseWhere = this.baseWhere(query);
    const where: Prisma.BookWhereInput = {
      ...baseWhere,
      ...(query.tab === 'in_stock'
        ? { availability: Availability.IN_STOCK }
        : query.tab === 'low_stock'
          ? { availability: Availability.LOW_STOCK }
          : query.tab === 'out_of_stock'
            ? { availability: Availability.OUT_OF_STOCK }
            : {}),
    };

    const [books, total, all, inStock, lowStock, outOfStock] =
      await Promise.all([
        this.prisma.book.findMany({
          where,
          skip,
          take,
          orderBy: [{ availability: 'asc' }, { title: 'asc' }],
          select: stockBookSelect,
        }),
        this.prisma.book.count({ where }),
        this.prisma.book.count({ where: baseWhere }),
        this.prisma.book.count({
          where: { ...baseWhere, availability: Availability.IN_STOCK },
        }),
        this.prisma.book.count({
          where: { ...baseWhere, availability: Availability.LOW_STOCK },
        }),
        this.prisma.book.count({
          where: { ...baseWhere, availability: Availability.OUT_OF_STOCK },
        }),
      ]);

    return {
      data: books.map((book) => ({
        book: {
          title: book.title,
          author: book.authorName,
          cover: book.coverImageUrl,
        },
        sku: book.sku,
        category: book.category,
        unitPrice: book.price,
        currentStock: book.stock,
        alertLimit: book.alertLimit,
        status: book.availability,
        stockValue: stockValue(book.stock, book.price),
        lastUpdated: book.stockMovements[0]?.createdAt ?? null,
      })),
      meta: {
        ...pageMeta(page, limit, total),
        tabCounts: {
          all,
          in_stock: inStock,
          low_stock: lowStock,
          out_of_stock: outOfStock,
        },
      },
    };
  }

  async getSummary() {
    const [totals, valueRows, availabilityGroups] = await Promise.all([
      this.prisma.book.aggregate({
        _count: { _all: true },
        _sum: { stock: true },
      }),
      this.prisma.$queryRaw<{ inventoryValue: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM("stock" * "price"), 0)::numeric AS "inventoryValue"
        FROM "Book"
      `,
      this.prisma.book.groupBy({
        by: ['availability'],
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(
      availabilityGroups.map((group) => [
        group.availability,
        group._count._all,
      ]),
    );
    const totalTitles = totals._count._all;
    return {
      totalTitles,
      totalUnits: totals._sum.stock ?? 0,
      inventoryValue: valueRows[0]?.inventoryValue ?? new Prisma.Decimal(0),
      lowStock: counts.get(Availability.LOW_STOCK) ?? 0,
      outOfStock: counts.get(Availability.OUT_OF_STOCK) ?? 0,
      tabCounts: {
        all: totalTitles,
        in_stock: counts.get(Availability.IN_STOCK) ?? 0,
        low_stock: counts.get(Availability.LOW_STOCK) ?? 0,
        out_of_stock: counts.get(Availability.OUT_OF_STOCK) ?? 0,
      },
    };
  }

  async createMovement(
    bookId: string,
    editorId: string,
    input: CreateStockMovementDTO,
  ) {
    if (
      ![
        StockMovementType.PURCHASE,
        StockMovementType.RETURN,
        StockMovementType.ADJUSTMENT,
        StockMovementType.DAMAGE,
      ].includes(input.type)
    ) {
      throw new BadRequestException(
        'This movement type is not available on the stock endpoint',
      );
    }
    if (
      input.type === StockMovementType.ADJUSTMENT &&
      input.direction === undefined
    ) {
      throw new BadRequestException(
        'direction is required for adjustment movements',
      );
    }
    if (
      input.type !== StockMovementType.ADJUSTMENT &&
      input.direction !== undefined
    ) {
      throw new BadRequestException(
        'direction is only valid for adjustment movements',
      );
    }

    return this.prisma.$transaction((transaction) =>
      this.applyMovement(transaction, {
        bookId,
        type: input.type,
        quantity: input.quantity,
        direction: input.direction,
        note: input.note,
        userId: editorId,
      }),
    );
  }

  async applyMovement(
    transaction: Prisma.TransactionClient,
    input: ApplyStockMovementInput,
  ) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }

    let delta: number;
    if (
      input.type === StockMovementType.ADJUSTMENT &&
      input.direction === undefined
    ) {
      throw new BadRequestException(
        'direction is required for adjustment movements',
      );
    }
    if (
      input.type !== StockMovementType.ADJUSTMENT &&
      input.direction !== undefined
    ) {
      throw new BadRequestException(
        'direction is only valid for adjustment movements',
      );
    }

    switch (input.type) {
      case StockMovementType.PURCHASE:
      case StockMovementType.RETURN:
        delta = input.quantity;
        break;
      case StockMovementType.ADJUSTMENT:
        delta = input.direction === 'in' ? input.quantity : -input.quantity;
        break;
      case StockMovementType.DAMAGE:
      case StockMovementType.SALE:
        delta = -input.quantity;
        break;
    }

    const updated =
      delta > 0
        ? await transaction.book.updateMany({
            where: { id: input.bookId },
            data: { stock: { increment: delta } },
          })
        : await transaction.book.updateMany({
            where: { id: input.bookId, stock: { gte: input.quantity } },
            data: { stock: { decrement: input.quantity } },
          });
    if (updated.count !== 1) {
      const exists = await transaction.book.findUnique({
        where: { id: input.bookId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Book not found');
      throw new ConflictException('Insufficient stock for this movement');
    }

    const current = await transaction.book.findUnique({
      where: { id: input.bookId },
      select: { stock: true, alertLimit: true, availability: true },
    });
    if (!current) throw new NotFoundException('Book not found');

    const availability = deriveAvailability(
      current.stock,
      current.alertLimit,
      current.availability,
    );
    const book = await transaction.book.update({
      where: { id: input.bookId },
      data: { availability },
      select: { stock: true, availability: true },
    });
    const movement = await transaction.stockMovement.create({
      data: {
        bookId: input.bookId,
        type: input.type,
        quantity: delta,
        balanceAfter: book.stock,
        note: input.note ?? null,
        orderId: input.orderId ?? null,
        createdById: input.userId ?? null,
      },
    });

    return { movement, stock: book.stock, availability: book.availability };
  }

  async getHistory(query: StockHistoryQueryDTO) {
    if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
      throw new BadRequestException('from cannot be later than to');
    }
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.StockMovementWhereInput = {
      ...(query.bookId ? { bookId: query.bookId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.createdBy ? { createdById: query.createdBy } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          bookId: true,
          type: true,
          quantity: true,
          balanceAfter: true,
          note: true,
          orderId: true,
          createdAt: true,
          book: {
            select: {
              id: true,
              title: true,
              authorName: true,
              sku: true,
              coverImageUrl: true,
            },
          },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return { data, meta: pageMeta(page, limit, total) };
  }

  async updateAlertLimit(bookId: string, input: UpdateAlertLimitDTO) {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.book.findUnique({
        where: { id: bookId },
        select: { stock: true, availability: true },
      });
      if (!current) throw new NotFoundException('Book not found');

      const availability = deriveAvailability(
        current.stock,
        input.alertLimit,
        current.availability,
      );
      return transaction.book.update({
        where: { id: bookId },
        data: { alertLimit: input.alertLimit, availability },
        select: {
          id: true,
          alertLimit: true,
          stock: true,
          availability: true,
          updatedAt: true,
        },
      });
    });
  }

  async getAlerts() {
    const [lowStock, outOfStock] = await Promise.all([
      this.prisma.book.findMany({
        where: { availability: Availability.LOW_STOCK },
        orderBy: [{ stock: 'asc' }, { title: 'asc' }],
        select: stockBookSelect,
      }),
      this.prisma.book.findMany({
        where: { availability: Availability.OUT_OF_STOCK },
        orderBy: { title: 'asc' },
        select: stockBookSelect,
      }),
    ]);
    return {
      lowStock: lowStock.map((book) => this.toStockRow(book)),
      outOfStock: outOfStock.map((book) => this.toStockRow(book)),
    };
  }

  async exportCsv(): Promise<StreamableFile> {
    const books = await this.prisma.book.findMany({
      orderBy: { title: 'asc' },
      select: stockBookSelect,
    });
    const rows = [
      [
        'Title',
        'Author',
        'SKU',
        'Category',
        'Unit price',
        'Current stock',
        'Alert limit',
        'Status',
        'Stock value',
        'Last movement',
      ],
      ...books.map((book) => [
        book.title,
        book.authorName,
        book.sku,
        book.category?.nameBn ?? book.category?.nameEn ?? null,
        book.price.toFixed(2),
        book.stock,
        book.alertLimit,
        book.availability,
        stockValue(book.stock, book.price).toFixed(2),
        book.stockMovements[0]?.createdAt.toISOString() ?? null,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="stock.csv"',
    });
  }

  private toStockRow(
    book: Prisma.BookGetPayload<{ select: typeof stockBookSelect }>,
  ) {
    return {
      book: {
        title: book.title,
        author: book.authorName,
        cover: book.coverImageUrl,
      },
      sku: book.sku,
      category: book.category,
      unitPrice: book.price,
      currentStock: book.stock,
      alertLimit: book.alertLimit,
      status: book.availability,
      stockValue: stockValue(book.stock, book.price),
      lastUpdated: book.stockMovements[0]?.createdAt ?? null,
    };
  }

  private baseWhere(query: StockQueryDTO): Prisma.BookWhereInput {
    return {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { authorName: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
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
}
