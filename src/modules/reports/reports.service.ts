import {
  BadRequestException,
  Injectable,
  StreamableFile,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import type { ReportRangeQueryDTO } from './dto/report-range-query.dto';

type Range = { start?: Date; end?: Date };

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function rangeOf(query: ReportRangeQueryDTO): Range {
  if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
    throw new BadRequestException('from cannot be later than to');
  }
  return {
    ...(query.from ? { start: query.from } : {}),
    ...(query.to ? { end: query.to } : {}),
  };
}

function cell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'bigint' ||
            typeof value === 'boolean'
          ? `${value}`
          : (JSON.stringify(value) ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function file(name: string, rows: unknown[][]): StreamableFile {
  const csv = `\uFEFF${rows.map((row) => row.map(cell).join(',')).join('\r\n')}`;
  return new StreamableFile(Buffer.from(csv, 'utf8'), {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${name}.csv"`,
  });
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async sales(query: ReportRangeQueryDTO) {
    const range = rangeOf(query);
    const start = range.start ?? new Date('1970-01-01T00:00:00.000Z');
    const end = range.end ?? new Date('9999-12-31T23:59:59.999Z');
    const channel = query.channel ?? null;
    return this.prisma.$queryRaw<
      { date: string; orders: number; revenue: Prisma.Decimal }[]
    >`
      SELECT
        TO_CHAR(("placedAt" + INTERVAL '6 hours')::date, 'YYYY-MM-DD') AS date,
        COUNT(*)::int AS orders,
        COALESCE(SUM("total"), 0)::numeric AS revenue
      FROM "Order"
      WHERE ("status" = 'COMPLETED' OR "paymentStatus" = 'PAID')
        AND "placedAt" >= ${start}
        AND "placedAt" <= ${end}
        AND "channel"::text = COALESCE(${channel}::text, "channel"::text)
      GROUP BY date
      ORDER BY date
    `;
  }

  async salesCsv(query: ReportRangeQueryDTO) {
    const rows = await this.sales(query);
    return file('sales-report', [
      ['Date', 'Orders', 'Revenue'],
      ...rows.map((row) => [row.date, row.orders, row.revenue.toFixed(2)]),
    ]);
  }

  async topBooks(query: ReportRangeQueryDTO) {
    const range = rangeOf(query);
    const groups = await this.prisma.orderItem.groupBy({
      by: ['bookId'],
      where: {
        order: {
          is: {
            OR: [{ status: 'COMPLETED' }, { paymentStatus: 'PAID' }],
            ...(range.start || range.end
              ? {
                  placedAt: {
                    ...(range.start ? { gte: range.start } : {}),
                    ...(range.end ? { lte: range.end } : {}),
                  },
                }
              : {}),
          },
        },
      },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
    });
    const books = groups.length
      ? await this.prisma.book.findMany({
          where: { id: { in: groups.map((group) => group.bookId) } },
          select: {
            id: true,
            title: true,
            authorName: true,
            sku: true,
            coverImageUrl: true,
          },
        })
      : [];
    const bookMap = new Map(books.map((book) => [book.id, book]));
    return groups.flatMap((group) => {
      const book = bookMap.get(group.bookId);
      return book
        ? [
            {
              book,
              copiesSold: group._sum?.quantity ?? 0,
              revenue: group._sum?.lineTotal ?? zero(),
            },
          ]
        : [];
    });
  }

  async topBooksCsv(query: ReportRangeQueryDTO) {
    const rows = await this.topBooks(query);
    return file('top-books-report', [
      ['Book ID', 'Title', 'Author', 'SKU', 'Copies sold', 'Revenue'],
      ...rows.map((row) => [
        row.book.id,
        row.book.title,
        row.book.authorName,
        row.book.sku,
        row.copiesSold,
        row.revenue.toFixed(2),
      ]),
    ]);
  }

  async stockValuation() {
    const [books, total] = await Promise.all([
      this.prisma.book.findMany({
        orderBy: { title: 'asc' },
        select: {
          id: true,
          title: true,
          sku: true,
          stock: true,
          price: true,
          wholesalePrice: true,
          availability: true,
        },
      }),
      this.prisma.$queryRaw<{ value: Prisma.Decimal }[]>`
        SELECT COALESCE(SUM("stock" * "price"), 0)::numeric AS value
        FROM "Book"
      `,
    ]);
    return {
      totalValue: total[0]?.value ?? zero(),
      books: books.map((book) => ({
        ...book,
        stockValue: book.price.mul(book.stock).toDecimalPlaces(2),
      })),
    };
  }

  async stockValuationCsv() {
    const report = await this.stockValuation();
    return file('stock-valuation-report', [
      [
        'Book ID',
        'Title',
        'SKU',
        'Stock',
        'Unit price',
        'Stock value',
        'Availability',
      ],
      ...report.books.map((book) => [
        book.id,
        book.title,
        book.sku,
        book.stock,
        book.price.toFixed(2),
        book.stockValue.toFixed(2),
        book.availability,
      ]),
      ['', '', '', '', 'Total', report.totalValue.toFixed(2), ''],
    ]);
  }

  async authorRoyalties(query: ReportRangeQueryDTO) {
    const range = rangeOf(query);
    const groups = await this.prisma.royaltyEntry.groupBy({
      by: ['authorId'],
      where: {
        ...(range.start || range.end
          ? {
              createdAt: {
                ...(range.start ? { gte: range.start } : {}),
                ...(range.end ? { lte: range.end } : {}),
              },
            }
          : {}),
      },
      _sum: { copies: true, amount: true },
    });
    const authors = groups.length
      ? await this.prisma.authorProfile.findMany({
          where: { id: { in: groups.map((group) => group.authorId) } },
          select: { id: true, user: { select: { name: true, email: true } } },
        })
      : [];
    const authorMap = new Map(authors.map((author) => [author.id, author]));
    return groups.flatMap((group) => {
      const author = authorMap.get(group.authorId);
      return author
        ? [
            {
              author,
              copies: group._sum.copies ?? 0,
              royalties: group._sum.amount ?? zero(),
            },
          ]
        : [];
    });
  }

  async authorRoyaltiesCsv(query: ReportRangeQueryDTO) {
    const rows = await this.authorRoyalties(query);
    return file('author-royalties-report', [
      ['Author ID', 'Author', 'Email', 'Copies', 'Royalties'],
      ...rows.map((row) => [
        row.author.id,
        row.author.user.name,
        row.author.user.email,
        row.copies,
        row.royalties.toFixed(2),
      ]),
    ]);
  }

  async costs(query: ReportRangeQueryDTO) {
    const range = rangeOf(query);
    const where: Prisma.CostEntryWhereInput = {
      ...(range.start || range.end
        ? {
            date: {
              ...(range.start ? { gte: range.start } : {}),
              ...(range.end ? { lte: range.end } : {}),
            },
          }
        : {}),
    };
    const [groups, entries] = await Promise.all([
      this.prisma.costEntry.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.costEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          category: true,
          productionType: true,
          title: true,
          amount: true,
          date: true,
          book: { select: { id: true, title: true } },
          employee: { select: { id: true, name: true } },
        },
      }),
    ]);
    const total = groups.reduce(
      (sum, group) => sum.plus(group._sum.amount ?? zero()),
      zero(),
    );
    return {
      total,
      byCategory: groups.map((group) => ({
        category: group.category,
        total: group._sum.amount ?? zero(),
        entries: group._count._all,
      })),
      entries,
    };
  }

  async costsCsv(query: ReportRangeQueryDTO) {
    const report = await this.costs(query);
    return file('costs-report', [
      [
        'Date',
        'Category',
        'Production type',
        'Title',
        'Book',
        'Employee',
        'Amount',
      ],
      ...report.entries.map((entry) => [
        entry.date.toISOString(),
        entry.category,
        entry.productionType,
        entry.title,
        entry.book?.title,
        entry.employee?.name,
        entry.amount.toFixed(2),
      ]),
      ['', '', '', '', '', 'Total', report.total.toFixed(2)],
    ]);
  }
}
