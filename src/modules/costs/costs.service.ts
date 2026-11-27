import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CostCategory,
  Prisma,
  ProductionCostType,
  UserRole,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import type { CostBooksQueryDTO } from './dto/cost-books-query.dto';
import type { CostMonthQueryDTO } from './dto/cost-month-query.dto';
import type { CostsQueryDTO } from './dto/costs-query.dto';
import type { CreateBookCostDTO } from './dto/create-book-cost.dto';
import type { CreateMarketingCostDTO } from './dto/create-marketing-cost.dto';
import type { CreateSalaryCostDTO } from './dto/create-salary-cost.dto';
import type { UpdateCostDTO } from './dto/update-cost.dto';

const otherCostCategories: CostCategory[] = [
  CostCategory.AUTHOR_COMMISSION,
  CostCategory.EMPLOYEE_SALARY,
  CostCategory.MARKETING,
];

const costEntrySelect = {
  id: true,
  category: true,
  productionType: true,
  payoutId: true,
  bookId: true,
  employeeId: true,
  title: true,
  amount: true,
  date: true,
  note: true,
  createdAt: true,
  book: {
    select: { id: true, title: true, sku: true, coverImageUrl: true },
  },
  employee: { select: { id: true, name: true, role: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.CostEntrySelect;

const bookProductionSelect = {
  id: true,
  productionType: true,
  title: true,
  amount: true,
  date: true,
  note: true,
  createdAt: true,
  bookId: true,
  book: {
    select: { id: true, title: true, sku: true, coverImageUrl: true },
  },
} satisfies Prisma.CostEntrySelect;

type BookProductionEntry = Prisma.CostEntryGetPayload<{
  select: typeof bookProductionSelect;
}>;

type MonthRange = { start: Date; end: Date; month: string };

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

function monthRange(month?: string): MonthRange {
  const selectedMonth = month ?? new Date().toISOString().slice(0, 7);
  const [yearText, monthText] = selectedMonth.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    end: new Date(Date.UTC(year, monthNumber, 1)),
    month: selectedMonth,
  };
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function emptyProductionTotals(): Record<ProductionCostType, Prisma.Decimal> {
  return {
    [ProductionCostType.PRINTING]: zero(),
    [ProductionCostType.PAPER]: zero(),
    [ProductionCostType.BINDING]: zero(),
    [ProductionCostType.DESIGN]: zero(),
    [ProductionCostType.EDITING]: zero(),
    [ProductionCostType.OTHER]: zero(),
  };
}

function sumCategories(
  groups: { category: CostCategory; _sum: { amount: Prisma.Decimal | null } }[],
) {
  const totals: Record<CostCategory, Prisma.Decimal> = {
    [CostCategory.BOOK_PRODUCTION]: zero(),
    [CostCategory.AUTHOR_COMMISSION]: zero(),
    [CostCategory.EMPLOYEE_SALARY]: zero(),
    [CostCategory.MARKETING]: zero(),
  };
  for (const group of groups) {
    totals[group.category] = group._sum.amount ?? zero();
  }
  return totals;
}

@Injectable()
export class CostsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(query: CostMonthQueryDTO) {
    const currentRange = monthRange(query.month);
    const previousStart = new Date(currentRange.start);
    previousStart.setUTCMonth(previousStart.getUTCMonth() - 1);
    const [currentGroups, previous] = await Promise.all([
      this.prisma.costEntry.groupBy({
        by: ['category'],
        where: {
          date: { gte: currentRange.start, lt: currentRange.end },
        },
        _sum: { amount: true },
      }),
      this.prisma.costEntry.aggregate({
        where: { date: { gte: previousStart, lt: currentRange.start } },
        _sum: { amount: true },
      }),
    ]);
    const totals = sumCategories(currentGroups);
    const grandTotal = Object.values(totals).reduce(
      (sum, amount) => sum.plus(amount),
      zero(),
    );
    const previousTotal = previous._sum.amount ?? zero();
    const changePercentVsPreviousMonth = previousTotal.isZero()
      ? grandTotal.isZero()
        ? 0
        : 100
      : grandTotal
          .minus(previousTotal)
          .mul(100)
          .div(previousTotal)
          .toDecimalPlaces(2)
          .toNumber();

    return {
      bookProduction: totals[CostCategory.BOOK_PRODUCTION],
      authorCommission: totals[CostCategory.AUTHOR_COMMISSION],
      employeeSalary: totals[CostCategory.EMPLOYEE_SALARY],
      marketing: totals[CostCategory.MARKETING],
      grandTotal,
      changePercentVsPreviousMonth,
    };
  }

  async getBookCosts(query: CostBooksQueryDTO) {
    const range = monthRange(query.month);
    const where: Prisma.CostEntryWhereInput = {
      category: CostCategory.BOOK_PRODUCTION,
      bookId: { not: null },
      date: { gte: range.start, lt: range.end },
      ...(query.search
        ? {
            book: {
              is: {
                OR: [
                  {
                    title: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                  { sku: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            },
          }
        : {}),
    };
    const [entries, monthTotal] = await Promise.all([
      this.prisma.costEntry.findMany({
        where,
        orderBy: [{ bookId: 'asc' }, { date: 'desc' }],
        select: bookProductionSelect,
      }),
      this.prisma.costEntry.aggregate({
        where: {
          category: CostCategory.BOOK_PRODUCTION,
          date: { gte: range.start, lt: range.end },
        },
        _sum: { amount: true },
      }),
    ]);

    const grouped = new Map<
      string,
      {
        book: NonNullable<BookProductionEntry['book']>;
        total: Prisma.Decimal;
        byType: Record<ProductionCostType, Prisma.Decimal>;
        entries: Omit<BookProductionEntry, 'book' | 'bookId'>[];
      }
    >();
    for (const entry of entries) {
      if (!entry.bookId || !entry.book) continue;
      let group = grouped.get(entry.bookId);
      if (!group) {
        group = {
          book: entry.book,
          total: zero(),
          byType: emptyProductionTotals(),
          entries: [],
        };
        grouped.set(entry.bookId, group);
      }
      group.total = group.total.plus(entry.amount);
      if (entry.productionType) {
        group.byType[entry.productionType] = group.byType[
          entry.productionType
        ].plus(entry.amount);
      }
      group.entries.push({
        id: entry.id,
        productionType: entry.productionType,
        title: entry.title,
        amount: entry.amount,
        date: entry.date,
        note: entry.note,
        createdAt: entry.createdAt,
      });
    }

    return {
      data: [...grouped.values()],
      month: range.month,
      monthTotal: monthTotal._sum.amount ?? zero(),
    };
  }

  async findAll(query: CostsQueryDTO) {
    if (query.category === CostCategory.BOOK_PRODUCTION) {
      throw new BadRequestException(
        'Use /costs/books to view book production costs',
      );
    }
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.CostEntryWhereInput = {
      category: query.category ?? { in: otherCostCategories },
      ...(query.month
        ? {
            date: {
              gte: monthRange(query.month).start,
              lt: monthRange(query.month).end,
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              {
                title: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              { note: { contains: query.search, mode: 'insensitive' } },
              {
                employee: {
                  is: {
                    name: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.costEntry.findMany({
        where,
        skip,
        take,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: costEntrySelect,
      }),
      this.prisma.costEntry.count({ where }),
    ]);
    return { data, meta: pageMeta(page, limit, total) };
  }

  async createBookCost(userId: string, input: CreateBookCostDTO) {
    const book = await this.prisma.book.findUnique({
      where: { id: input.bookId },
      select: { id: true },
    });
    if (!book) throw new NotFoundException('Book not found');
    return this.prisma.costEntry.create({
      data: {
        category: CostCategory.BOOK_PRODUCTION,
        productionType: input.productionType,
        amount: decimal(input.amount),
        date: input.date,
        ...(input.note !== undefined ? { note: input.note } : {}),
        book: { connect: { id: book.id } },
        createdBy: { connect: { id: userId } },
      },
      select: costEntrySelect,
    });
  }

  async createSalaryCost(userId: string, input: CreateSalaryCostDTO) {
    const employee = await this.prisma.user.findUnique({
      where: { id: input.employeeId },
      select: { id: true, role: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.role !== UserRole.WORKER && employee.role !== UserRole.ADMIN) {
      throw new BadRequestException('Employee must have WORKER or ADMIN role');
    }
    return this.prisma.costEntry.create({
      data: {
        category: CostCategory.EMPLOYEE_SALARY,
        amount: decimal(input.amount),
        date: input.date,
        ...(input.note !== undefined ? { note: input.note } : {}),
        employee: { connect: { id: employee.id } },
        createdBy: { connect: { id: userId } },
      },
      select: costEntrySelect,
    });
  }

  createMarketingCost(userId: string, input: CreateMarketingCostDTO) {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('title cannot be empty');
    return this.prisma.costEntry.create({
      data: {
        category: CostCategory.MARKETING,
        title,
        amount: decimal(input.amount),
        date: input.date,
        ...(input.note !== undefined ? { note: input.note } : {}),
        createdBy: { connect: { id: userId } },
      },
      select: costEntrySelect,
    });
  }

  async update(id: string, input: UpdateCostDTO) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one cost field is required');
    }
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.costEntry.findUnique({
        where: { id },
        select: { id: true, category: true },
      });
      if (!current) throw new NotFoundException('Cost entry not found');

      if (
        input.productionType !== undefined &&
        current.category !== CostCategory.BOOK_PRODUCTION
      ) {
        throw new BadRequestException(
          'productionType can only be updated for book production costs',
        );
      }
      if (
        input.bookId !== undefined &&
        current.category !== CostCategory.BOOK_PRODUCTION
      ) {
        throw new BadRequestException(
          'bookId can only be updated for book production costs',
        );
      }
      if (
        input.employeeId !== undefined &&
        current.category !== CostCategory.EMPLOYEE_SALARY
      ) {
        throw new BadRequestException(
          'employeeId can only be updated for salary costs',
        );
      }

      const data: Prisma.CostEntryUpdateInput = {};
      if (input.amount !== undefined) data.amount = decimal(input.amount);
      if (input.date !== undefined) data.date = input.date;
      if (input.note !== undefined) data.note = input.note;
      if (input.title !== undefined) data.title = input.title;
      if (input.productionType !== undefined) {
        data.productionType = input.productionType;
      }
      if (input.bookId !== undefined) {
        const book = await transaction.book.findUnique({
          where: { id: input.bookId },
          select: { id: true },
        });
        if (!book) throw new NotFoundException('Book not found');
        data.book = { connect: { id: book.id } };
      }
      if (input.employeeId !== undefined) {
        const employee = await transaction.user.findUnique({
          where: { id: input.employeeId },
          select: { id: true, role: true },
        });
        if (!employee) throw new NotFoundException('Employee not found');
        if (
          employee.role !== UserRole.WORKER &&
          employee.role !== UserRole.ADMIN
        ) {
          throw new BadRequestException(
            'Employee must have WORKER or ADMIN role',
          );
        }
        data.employee = { connect: { id: employee.id } };
      }
      return transaction.costEntry.update({
        where: { id },
        data,
        select: costEntrySelect,
      });
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.costEntry.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Cost entry not found');
    await this.prisma.costEntry.delete({ where: { id } });
    return { id };
  }

  async exportCsv(query: CostMonthQueryDTO): Promise<StreamableFile> {
    const range = query.month ? monthRange(query.month) : undefined;
    const entries = await this.prisma.costEntry.findMany({
      where: range ? { date: { gte: range.start, lt: range.end } } : undefined,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: costEntrySelect,
    });
    const rows = [
      [
        'Date',
        'Category',
        'Production type',
        'Title',
        'Book',
        'Employee',
        'Amount',
        'Note',
        'Created by',
      ],
      ...entries.map((entry) => [
        entry.date.toISOString(),
        entry.category,
        entry.productionType,
        entry.title,
        entry.book?.title ?? null,
        entry.employee?.name ?? null,
        entry.amount.toFixed(2),
        entry.note,
        entry.createdBy.name,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="costs.csv"',
    });
  }

  @OnEvent('payout.paid')
  async handlePayoutPaid(event: {
    payoutId: string;
    amount: Prisma.Decimal;
    payoutCode: string;
    paidAt: Date;
    createdById: string;
  }): Promise<void> {
    await this.prisma.costEntry.createMany({
      data: [
        {
          payoutId: event.payoutId,
          category: CostCategory.AUTHOR_COMMISSION,
          amount: event.amount,
          title: `Royalty payout ${event.payoutCode}`,
          date: event.paidAt,
          createdById: event.createdById,
        },
      ],
      skipDuplicates: true,
    });
  }
}
