import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryStatus,
  BookStatus,
  IssueStatus,
  OrderChannel,
  OrderStatus,
  PaymentStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateOrderIssueDTO } from './dto/create-order-issue.dto';
import { CreateOrderDTO } from './dto/create-order.dto';
import { OrderIssuesQueryDTO } from './dto/create-order-issue.dto';
import { OrdersQueryDTO } from './dto/orders-query.dto';
import { DeliveryChargeService } from './delivery-charge.service';

const orderDetailSelect = {
  id: true,
  orderNo: true,
  channel: true,
  status: true,
  deliveryStatus: true,
  paymentStatus: true,
  paymentMethod: true,
  subtotal: true,
  discountAmount: true,
  deliveryCharge: true,
  total: true,
  paidAmount: true,
  dueAmount: true,
  note: true,
  placedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  shipName: true,
  shipPhone: true,
  shipAddress: true,
  shipDistrict: true,
  trackingNo: true,
  courier: { select: { id: true, name: true, phone: true } },
  orderItems: {
    select: {
      id: true,
      titleSnapshot: true,
      unitPrice: true,
      quantity: true,
      lineTotal: true,
      book: {
        select: { id: true, slug: true, coverImageUrl: true, authorName: true },
      },
    },
  },
  orderStatusHistories: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      deliveryStatus: true,
      note: true,
      createdAt: true,
    },
  },
} satisfies Prisma.OrderSelect;

const issueSelect = {
  id: true,
  subject: true,
  details: true,
  status: true,
  resolution: true,
  createdAt: true,
  updatedAt: true,
  order: { select: { id: true, orderNo: true, status: true } },
} satisfies Prisma.OrderIssueSelect;

function isPrismaError(
  error: unknown,
  ...codes: string[]
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

function orderDateStamp(date: Date): string {
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

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly deliveryChargeService: DeliveryChargeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(userId: string, input: CreateOrderDTO) {
    const bookQuantities = new Map<string, number>();
    for (const item of input.items) {
      bookQuantities.set(
        item.bookId,
        (bookQuantities.get(item.bookId) ?? 0) + item.quantity,
      );
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const order = await this.prisma.$transaction(async (transaction) => {
          const address = await transaction.address.findFirst({
            where: { id: input.addressId, userId },
            select: {
              id: true,
              fullName: true,
              phone: true,
              division: true,
              district: true,
              upazila: true,
              details: true,
            },
          });
          if (!address) {
            throw new NotFoundException('Delivery address not found');
          }

          const books = await transaction.book.findMany({
            where: {
              id: { in: [...bookQuantities.keys()] },
              status: BookStatus.PUBLISHED,
            },
            select: {
              id: true,
              title: true,
              salePrice: true,
              stock: true,
            },
          });
          const booksById = new Map(books.map((book) => [book.id, book]));
          if (booksById.size !== bookQuantities.size) {
            throw new BadRequestException(
              'One or more selected books are not available for purchase',
            );
          }
          for (const [bookId, quantity] of bookQuantities) {
            const book = booksById.get(bookId);
            if (!book || book.stock < quantity) {
              throw new ConflictException(
                'One or more books do not have enough stock',
              );
            }
          }

          const deliveryCharge = await this.deliveryChargeService.getCharge(
            address.district,
            transaction,
          );
          const items = input.items.map((item) => {
            const book = booksById.get(item.bookId);
            if (!book) {
              throw new BadRequestException(
                'One or more selected books are not available for purchase',
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
          const subtotal = items.reduce(
            (total, item) => total.plus(item.lineTotal),
            new Prisma.Decimal(0),
          );
          const discountAmount = new Prisma.Decimal(0);
          const total = subtotal.minus(discountAmount).plus(deliveryCharge);
          const orderNo = await this.nextOrderNo(transaction, new Date());
          const shipAddress = [
            address.details,
            address.upazila,
            address.district,
            address.division,
          ]
            .filter(Boolean)
            .join(', ');

          const createdOrder = await transaction.order.create({
            data: {
              orderNo,
              channel: OrderChannel.WEBSITE,
              customerId: userId,
              addressId: address.id,
              shipName: address.fullName,
              shipPhone: address.phone,
              shipAddress,
              shipDistrict: address.district,
              status: OrderStatus.NEW,
              deliveryStatus: DeliveryStatus.NOT_DISPATCHED,
              paymentStatus: PaymentStatus.UNPAID,
              paymentMethod: input.paymentMethod,
              subtotal,
              discountAmount,
              deliveryCharge,
              total,
              paidAmount: new Prisma.Decimal(0),
              dueAmount: total,
              note: input.note,
              orderItems: {
                create: items.map((item) => ({
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
              status: OrderStatus.NEW,
              deliveryStatus: DeliveryStatus.NOT_DISPATCHED,
              note: 'Order placed',
              changedById: userId,
            },
          });

          for (const item of input.items) {
            await this.stockService.applyMovement(transaction, {
              bookId: item.bookId,
              type: StockMovementType.SALE,
              quantity: item.quantity,
              orderId: createdOrder.id,
              userId,
            });
          }

          return transaction.order.findUniqueOrThrow({
            where: { id: createdOrder.id },
            select: orderDetailSelect,
          });
        });

        this.eventEmitter.emit('order.placed', { orderId: order.id });
        return order;
      } catch (error) {
        if (isPrismaError(error, 'P2002') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002')) {
          throw new ConflictException(
            'Could not allocate an order number; please try again',
          );
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not allocate an order number; please try again',
    );
  }

  async findMine(userId: string, query: OrdersQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const baseWhere = this.myOrdersWhere(userId, query.search);
    const tabWhere = this.tabWhere(query.tab);
    const where: Prisma.OrderWhereInput = { ...baseWhere, ...tabWhere };
    const [
      orders,
      total,
      allCount,
      newCount,
      processingCount,
      inTransitCount,
      deliveredCount,
      cancelledCount,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy: { placedAt: 'desc' },
        select: {
          id: true,
          orderNo: true,
          status: true,
          deliveryStatus: true,
          total: true,
          placedAt: true,
          orderItems: {
            select: {
              titleSnapshot: true,
              unitPrice: true,
              quantity: true,
              book: { select: { coverImageUrl: true, authorName: true } },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.count({ where: baseWhere }),
      this.prisma.order.count({
        where: {
          ...baseWhere,
          status: { in: [OrderStatus.NEW, OrderStatus.PENDING] },
        },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.PROCESSING },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, deliveryStatus: DeliveryStatus.IN_TRANSIT },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, deliveryStatus: DeliveryStatus.DELIVERED },
      }),
      this.prisma.order.count({
        where: { ...baseWhere, status: OrderStatus.CANCELLED },
      }),
    ]);

    return {
      data: orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        items: order.orderItems.map((item) => ({
          title: item.titleSnapshot,
          cover: item.book.coverImageUrl,
          author: item.book.authorName,
          qty: item.quantity,
          price: item.unitPrice,
        })),
        itemCount: order.orderItems.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        total: order.total,
        status: order.status,
        deliveryStatus: order.deliveryStatus,
        placedAt: order.placedAt,
        canWriteReview: order.deliveryStatus === DeliveryStatus.DELIVERED,
        canCancel: this.canCancel(order.status),
      })),
      meta: {
        ...pageMeta(page, limit, total),
        tabCounts: {
          all: allCount,
          new: newCount,
          processing: processingCount,
          in_transit: inTransitCount,
          delivered: deliveredCount,
          cancelled: cancelledCount,
        },
      },
    };
  }

  async getMineById(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId },
      select: orderDetailSelect,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async getTrack(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, customerId: userId },
      select: {
        id: true,
        orderNo: true,
        status: true,
        deliveryStatus: true,
        trackingNo: true,
        courier: { select: { id: true, name: true, phone: true } },
        orderStatusHistories: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            status: true,
            deliveryStatus: true,
            note: true,
            createdAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      orderNo: order.orderNo,
      status: order.status,
      deliveryStatus: order.deliveryStatus,
      courier: order.courier,
      trackingNo: order.trackingNo,
      timeline: order.orderStatusHistories,
    };
  }

  async cancel(userId: string, id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id, customerId: userId },
        select: {
          id: true,
          status: true,
          orderItems: { select: { bookId: true, quantity: true } },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (!this.canCancel(order.status)) {
        throw new ConflictException('This order can no longer be cancelled');
      }

      const cancelledAt = new Date();
      const update = await transaction.order.updateMany({
        where: {
          id,
          customerId: userId,
          status: { in: [OrderStatus.NEW, OrderStatus.PENDING] },
        },
        data: { status: OrderStatus.CANCELLED, cancelledAt },
      });
      if (update.count !== 1) {
        throw new ConflictException('This order can no longer be cancelled');
      }

      await transaction.orderStatusHistory.create({
        data: {
          orderId: id,
          status: OrderStatus.CANCELLED,
          note: 'Order cancelled by customer',
          changedById: userId,
        },
      });
      for (const item of order.orderItems) {
        await this.stockService.applyMovement(transaction, {
          bookId: item.bookId,
          type: StockMovementType.RETURN,
          quantity: item.quantity,
          note: 'order cancelled',
          orderId: id,
          userId,
        });
      }

      return transaction.order.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          orderNo: true,
          status: true,
          cancelledAt: true,
        },
      });
    });
  }

  async createIssue(
    userId: string,
    orderId: string,
    input: CreateOrderIssueDTO,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const order = await transaction.order.findFirst({
              where: { id: orderId, customerId: userId },
              select: { id: true },
            });
            if (!order) throw new NotFoundException('Order not found');

            const openCount = await transaction.orderIssue.count({
              where: {
                orderId,
                userId,
                status: { in: [IssueStatus.OPEN, IssueStatus.IN_PROGRESS] },
              },
            });
            if (openCount >= 3) {
              throw new ConflictException(
                'A maximum of three open issues is allowed per order',
              );
            }

            return transaction.orderIssue.create({
              data: {
                orderId,
                userId,
                subject: input.subject,
                details: input.details,
              },
              select: issueSelect,
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isPrismaError(error, 'P2034') && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Could not submit issue; please try again');
  }

  async getMyIssues(userId: string, query: OrderIssuesQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.OrderIssueWhereInput = { userId };
    const [data, total] = await Promise.all([
      this.prisma.orderIssue.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: issueSelect,
      }),
      this.prisma.orderIssue.count({ where }),
    ]);
    return { data, meta: pageMeta(page, limit, total) };
  }

  private myOrdersWhere(
    userId: string,
    search?: string,
  ): Prisma.OrderWhereInput {
    return {
      customerId: userId,
      ...(search
        ? {
            OR: [
              { orderNo: { contains: search, mode: 'insensitive' } },
              {
                orderItems: {
                  some: {
                    titleSnapshot: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private tabWhere(tab: OrdersQueryDTO['tab']): Prisma.OrderWhereInput {
    switch (tab) {
      case 'new':
        return { status: { in: [OrderStatus.NEW, OrderStatus.PENDING] } };
      case 'processing':
        return { status: OrderStatus.PROCESSING };
      case 'in_transit':
        return { deliveryStatus: DeliveryStatus.IN_TRANSIT };
      case 'delivered':
        return { deliveryStatus: DeliveryStatus.DELIVERED };
      case 'cancelled':
        return { status: OrderStatus.CANCELLED };
      default:
        return {};
    }
  }

  private canCancel(status: OrderStatus): boolean {
    return status === OrderStatus.NEW || status === OrderStatus.PENDING;
  }

  private async nextOrderNo(
    transaction: Prisma.TransactionClient,
    now: Date,
  ): Promise<string> {
    const prefix = `ORD-${orderDateStamp(now)}-`;
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
