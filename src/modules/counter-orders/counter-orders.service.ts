import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryStatus,
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  Prisma,
  StockMovementType,
  UserStatus,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { StockService } from '../stock/stock.service';
import { AddCounterPaymentDTO } from './dto/add-counter-payment.dto';
import { CreateCounterOrderDTO } from './dto/create-counter-order.dto';
import { CounterOrdersQueryDTO } from './dto/counter-orders-query.dto';

type CounterOrderLine = {
  unitPrice: Prisma.Decimal;
  quantity: number;
};

type CounterTotals = {
  subtotal: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
  total: Prisma.Decimal;
};

export function calcCounterTotals(
  items: readonly CounterOrderLine[],
  commissionRate: Prisma.Decimal,
): CounterTotals {
  const subtotal = items.reduce(
    (sum, item) => sum.plus(item.unitPrice.mul(item.quantity)),
    new Prisma.Decimal(0),
  );
  const commissionAmount = subtotal
    .mul(commissionRate)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return {
    subtotal,
    commissionAmount,
    total: subtotal.minus(commissionAmount),
  };
}

const invoiceSelect = {
  id: true,
  orderNo: true,
  status: true,
  deliveryStatus: true,
  paymentStatus: true,
  paymentMethod: true,
  placedAt: true,
  repName: true,
  subtotal: true,
  commissionRate: true,
  commissionAmount: true,
  total: true,
  paidAmount: true,
  dueAmount: true,
  note: true,
  staff: { select: { id: true, name: true } },
  shop: {
    select: {
      id: true,
      name: true,
      ownerName: true,
      phone: true,
      whatsapp: true,
      district: true,
      area: true,
      address: true,
    },
  },
  orderItems: {
    select: {
      id: true,
      titleSnapshot: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      book: {
        select: { id: true, sku: true, authorName: true, coverImageUrl: true },
      },
    },
  },
  payments: {
    orderBy: { paidAt: 'asc' },
    select: {
      id: true,
      amount: true,
      method: true,
      transactionId: true,
      paidAt: true,
      receivedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

function isPrismaError(
  error: unknown,
  ...codes: string[]
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

function dhakaDateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}${part('month')}${part('day')}`;
}

function startOfDhakaDay(date: Date): Date {
  const stamp = dhakaDateStamp(date);
  return new Date(
    `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00+06:00`,
  );
}

function getDhakaDayBounds(date: Date) {
  const start = startOfDhakaDay(date);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function getPaymentStatus(
  paidAmount: Prisma.Decimal,
  dueAmount: Prisma.Decimal,
): PaymentStatus {
  if (dueAmount.isZero()) return PaymentStatus.PAID;
  if (paidAmount.isZero()) return PaymentStatus.UNPAID;
  return PaymentStatus.PARTIAL;
}

@Injectable()
export class CounterOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(staffId: string, input: CreateCounterOrderDTO) {
    const now = new Date();
    const requestedQuantities = new Map<string, number>();
    for (const item of input.items) {
      requestedQuantities.set(
        item.bookId,
        (requestedQuantities.get(item.bookId) ?? 0) + item.quantity,
      );
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const order = await this.prisma.$transaction(async (transaction) => {
          const shop = await transaction.shop.findUnique({
            where: { id: input.shopId },
            select: { id: true, status: true, commissionRate: true },
          });
          if (!shop) throw new NotFoundException('Shop not found');
          if (shop.status !== UserStatus.ACTIVE) {
            throw new ConflictException('Suspended shops cannot place orders');
          }

          const books = await transaction.book.findMany({
            where: { id: { in: [...requestedQuantities.keys()] } },
            select: { id: true, title: true, salePrice: true, stock: true },
          });
          const booksById = new Map(books.map((book) => [book.id, book]));
          if (booksById.size !== requestedQuantities.size) {
            throw new BadRequestException(
              'One or more selected books were not found',
            );
          }
          for (const [bookId, quantity] of requestedQuantities) {
            const book = booksById.get(bookId);
            if (!book || book.stock < quantity) {
              throw new ConflictException(
                'One or more books do not have enough stock',
              );
            }
          }

          const commissionRate =
            input.commissionRate === undefined || input.commissionRate === null
              ? shop.commissionRate
              : new Prisma.Decimal(input.commissionRate.toString());
          const lineItems = input.items.map((item) => {
            const book = booksById.get(item.bookId);
            if (!book) {
              throw new BadRequestException(
                'One or more selected books were not found',
              );
            }
            return {
              bookId: book.id,
              titleSnapshot: book.title,
              unitPrice: book.salePrice,
              quantity: item.quantity,
              lineTotal: book.salePrice.mul(item.quantity),
            };
          });
          const totals = calcCounterTotals(lineItems, commissionRate);
          const paidAmount = new Prisma.Decimal(input.paidAmount.toString());
          if (paidAmount.greaterThan(totals.total)) {
            throw new BadRequestException(
              'paidAmount cannot exceed the order total',
            );
          }
          const dueAmount = totals.total.minus(paidAmount);
          const paymentStatus = getPaymentStatus(paidAmount, dueAmount);
          const orderNo = await this.nextOrderNo(transaction, now);

          const createdOrder = await transaction.order.create({
            data: {
              orderNo,
              channel: OrderChannel.COUNTER,
              shopId: shop.id,
              staffId,
              repName: input.repName,
              status: OrderStatus.COMPLETED,
              deliveryStatus: DeliveryStatus.COUNTER_HANDOVER,
              paymentStatus,
              paymentMethod: input.paymentMethod,
              subtotal: totals.subtotal,
              discountAmount: new Prisma.Decimal(0),
              commissionRate,
              commissionAmount: totals.commissionAmount,
              deliveryCharge: new Prisma.Decimal(0),
              total: totals.total,
              paidAmount,
              dueAmount,
              note: input.note,
              orderItems: {
                create: lineItems.map((item) => ({
                  titleSnapshot: item.titleSnapshot,
                  unitPrice: item.unitPrice,
                  quantity: item.quantity,
                  lineTotal: item.lineTotal,
                  book: { connect: { id: item.bookId } },
                })),
              },
            },
            select: { id: true },
          });

          await transaction.orderStatusHistory.create({
            data: {
              orderId: createdOrder.id,
              status: OrderStatus.COMPLETED,
              deliveryStatus: DeliveryStatus.COUNTER_HANDOVER,
              note: 'Counter order completed',
              changedById: staffId,
            },
          });
          if (paidAmount.greaterThan(0)) {
            await transaction.payment.create({
              data: {
                orderId: createdOrder.id,
                amount: paidAmount,
                method: input.paymentMethod,
                receivedById: staffId,
              },
            });
          }
          for (const item of input.items) {
            await this.stockService.applyMovement(transaction, {
              bookId: item.bookId,
              type: StockMovementType.SALE,
              quantity: item.quantity,
              orderId: createdOrder.id,
              userId: staffId,
              note: 'Counter sale',
            });
          }

          return transaction.order.findUniqueOrThrow({
            where: { id: createdOrder.id },
            select: invoiceSelect,
          });
        });

        this.eventEmitter.emit('order.completed', { orderId: order.id });
        return order;
      } catch (error) {
        if (isPrismaError(error, 'P2002') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002')) {
          throw new ConflictException(
            'Could not allocate a counter order number; please try again',
          );
        }
        throw error;
      }
    }
    throw new ConflictException(
      'Could not allocate a counter order number; please try again',
    );
  }

  async collectPayment(
    staffId: string,
    orderId: string,
    input: AddCounterPaymentDTO,
  ) {
    const amount = new Prisma.Decimal(input.amount.toString());
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id: orderId, channel: OrderChannel.COUNTER },
        select: { id: true, paidAmount: true, dueAmount: true },
      });
      if (!order) throw new NotFoundException('Counter order not found');
      if (amount.greaterThan(order.dueAmount)) {
        throw new BadRequestException('Payment amount exceeds the order due');
      }

      const update = await transaction.order.updateMany({
        where: {
          id: orderId,
          channel: OrderChannel.COUNTER,
          dueAmount: { gte: amount },
        },
        data: {
          paidAmount: { increment: amount },
          dueAmount: { decrement: amount },
        },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          'The order due changed; refresh and try again',
        );
      }

      const updatedAmounts = await transaction.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { paidAmount: true, dueAmount: true },
      });
      const paymentStatus = getPaymentStatus(
        updatedAmounts.paidAmount,
        updatedAmounts.dueAmount,
      );
      const updatedOrder = await transaction.order.update({
        where: { id: orderId },
        data: { paymentStatus },
        select: {
          id: true,
          orderNo: true,
          paidAmount: true,
          dueAmount: true,
          paymentStatus: true,
        },
      });
      const payment = await transaction.payment.create({
        data: {
          orderId,
          amount,
          method: input.method,
          transactionId: input.transactionId,
          receivedById: staffId,
        },
        select: {
          id: true,
          amount: true,
          method: true,
          transactionId: true,
          paidAt: true,
        },
      });

      return { payment, order: updatedOrder };
    });
  }

  async findAll(query: CounterOrdersQueryDTO) {
    if (query.from && query.to && query.from.getTime() > query.to.getTime()) {
      throw new BadRequestException('from cannot be later than to');
    }

    const now = new Date();
    const today = getDhakaDayBounds(now);
    const from = query.from ? startOfDhakaDay(query.from) : undefined;
    const to = query.to ? getDhakaDayBounds(query.to).end : undefined;
    const starts: Date[] = [];
    const ends: Date[] = [];
    if (from) starts.push(from);
    if (to) ends.push(to);
    if (query.tab === 'today') {
      starts.push(today.start);
      ends.push(today.end);
    }
    const gte = starts.length
      ? new Date(Math.max(...starts.map((date) => date.getTime())))
      : undefined;
    const lt = ends.length
      ? new Date(Math.min(...ends.map((date) => date.getTime())))
      : undefined;

    const where: Prisma.OrderWhereInput = {
      channel: OrderChannel.COUNTER,
      ...(query.tab === 'paid' ? { paymentStatus: PaymentStatus.PAID } : {}),
      ...(query.tab === 'due'
        ? { dueAmount: { gt: new Prisma.Decimal(0) } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { orderNo: { contains: query.search, mode: 'insensitive' } },
              {
                shop: {
                  is: {
                    OR: [
                      {
                        name: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        phone: {
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
      ...(gte || lt
        ? {
            placedAt: {
              ...(gte ? { gte } : {}),
              ...(lt ? { lt } : {}),
            },
          }
        : {}),
    };
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const [orders, total, totals, totalCounterOrders, memosToday] =
      await Promise.all([
        this.prisma.order.findMany({
          where,
          skip,
          take,
          orderBy: { placedAt: 'desc' },
          select: {
            id: true,
            orderNo: true,
            commissionRate: true,
            commissionAmount: true,
            total: true,
            paymentStatus: true,
            placedAt: true,
            shop: { select: { id: true, name: true, phone: true } },
          },
        }),
        this.prisma.order.count({ where }),
        this.prisma.order.aggregate({
          where: {
            channel: OrderChannel.COUNTER,
            placedAt: { gte: today.start, lt: today.end },
          },
          _sum: { total: true, commissionAmount: true },
        }),
        this.prisma.order.count({ where: { channel: OrderChannel.COUNTER } }),
        this.prisma.order.count({
          where: {
            channel: OrderChannel.COUNTER,
            placedAt: { gte: today.start, lt: today.end },
          },
        }),
      ]);

    return {
      data: orders.map((order) => ({
        id: order.id,
        shop: order.shop ? { id: order.shop.id, name: order.shop.name } : null,
        orderNo: order.orderNo,
        phone: order.shop?.phone ?? null,
        commissionRate: order.commissionRate,
        commissionAmount: order.commissionAmount,
        total: order.total,
        paymentStatus: order.paymentStatus,
      })),
      meta: {
        ...pageMeta(page, limit, total),
        stats: {
          todaySales: totals._sum.total ?? new Prisma.Decimal(0),
          todayCommission:
            totals._sum.commissionAmount ?? new Prisma.Decimal(0),
          totalCounterOrders,
          memosToday,
        },
      },
    };
  }

  async getById(orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, channel: OrderChannel.COUNTER },
      select: invoiceSelect,
    });
    if (!order) throw new NotFoundException('Counter order not found');
    return order;
  }

  private async nextOrderNo(
    transaction: Prisma.TransactionClient,
    now: Date,
  ): Promise<string> {
    const prefix = `CNT-${dhakaDateStamp(now)}-`;
    const existing = await transaction.order.findMany({
      where: { orderNo: { startsWith: prefix } },
      select: { orderNo: true },
    });
    const maxSequence = existing.reduce((max, order) => {
      const suffix = order.orderNo.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) return max;
      return Math.max(max, Number(suffix));
    }, 0);
    return `${prefix}${String(maxSequence + 1).padStart(3, '0')}`;
  }
}
