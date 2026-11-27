import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StockMovementType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { StockService } from '../stock/stock.service';
import { AdminOrdersQueryDTO } from './dto/admin-orders-query.dto';
import { AdminPaymentDTO } from './dto/admin-payment.dto';
import { AssignCourierDTO } from './dto/assign-order.dto';
import { AdminOrderIssuesQueryDTO } from './dto/order-issues-query.dto';
import { UpdateOrderIssueDTO } from './dto/update-order-issue.dto';
import { UpdateOrderStatusDTO } from './dto/update-order-status.dto';

const orderStatusTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.NEW]: [
    OrderStatus.PENDING,
    OrderStatus.PROCESSING,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PENDING]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.RETURNED]: [],
};

const deliveryStatusTransitions: Record<
  DeliveryStatus,
  readonly DeliveryStatus[]
> = {
  [DeliveryStatus.NOT_DISPATCHED]: [DeliveryStatus.READY_TO_SHIP],
  [DeliveryStatus.READY_TO_SHIP]: [DeliveryStatus.IN_TRANSIT],
  [DeliveryStatus.IN_TRANSIT]: [
    DeliveryStatus.DELIVERED,
    DeliveryStatus.FAILED,
  ],
  [DeliveryStatus.DELIVERED]: [DeliveryStatus.RETURNED],
  [DeliveryStatus.FAILED]: [DeliveryStatus.IN_TRANSIT, DeliveryStatus.RETURNED],
  [DeliveryStatus.RETURNED]: [],
  [DeliveryStatus.COUNTER_HANDOVER]: [DeliveryStatus.RETURNED],
};

const orderListSelect = {
  id: true,
  orderNo: true,
  channel: true,
  status: true,
  deliveryStatus: true,
  paymentStatus: true,
  total: true,
  placedAt: true,
  trackingNo: true,
  courier: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  shop: { select: { id: true, name: true, phone: true } },
  _count: { select: { orderItems: true } },
} satisfies Prisma.OrderSelect;

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
  commissionRate: true,
  commissionAmount: true,
  total: true,
  paidAmount: true,
  dueAmount: true,
  note: true,
  placedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  trackingNo: true,
  shipName: true,
  shipPhone: true,
  shipAddress: true,
  shipDistrict: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  shop: {
    select: {
      id: true,
      name: true,
      ownerName: true,
      phone: true,
      district: true,
      area: true,
      address: true,
    },
  },
  staff: { select: { id: true, name: true } },
  address: true,
  courier: { select: { id: true, name: true, phone: true } },
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
  orderStatusHistories: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      deliveryStatus: true,
      note: true,
      createdAt: true,
      changedBy: { select: { id: true, name: true } },
    },
  },
  orderIssues: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      subject: true,
      details: true,
      status: true,
      resolution: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.OrderSelect;

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function getDhakaDayBounds(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((value) => value.type === type)?.value ?? '';
  const stamp = `${part('year')}-${part('month')}-${part('day')}`;
  const start = new Date(`${stamp}T00:00:00+06:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function paymentStatusFor(
  paidAmount: Prisma.Decimal,
  dueAmount: Prisma.Decimal,
): PaymentStatus {
  if (dueAmount.isZero()) return PaymentStatus.PAID;
  if (paidAmount.isZero()) return PaymentStatus.UNPAID;
  return PaymentStatus.PARTIAL;
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

@Injectable()
export class OrderManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(query: AdminOrdersQueryDTO) {
    this.validateDateRange(query.from, query.to);
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where = this.buildWhere(query);
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take,
        orderBy:
          query.sort === 'total'
            ? [{ total: 'desc' }, { placedAt: 'desc' }]
            : { placedAt: 'desc' },
        select: orderListSelect,
      }),
      this.prisma.order.count({ where }),
    ]);
    const copyCounts = await this.getCopyCounts(
      orders.map((order) => order.id),
    );

    return {
      data: orders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        channel: order.channel,
        customerName: order.customer?.name ?? null,
        shopName: order.shop?.name ?? null,
        phone: order.customer?.phone ?? order.shop?.phone ?? null,
        itemCount: order._count.orderItems,
        copiesCount: copyCounts.get(order.id) ?? 0,
        total: order.total,
        paymentStatus: order.paymentStatus,
        orderStatus: order.status,
        deliveryStatus: order.deliveryStatus,
        placedAt: order.placedAt,
        courier: order.courier,
        trackingNo: order.trackingNo,
      })),
      meta: pageMeta(page, limit, total),
    };
  }

  async getStats() {
    const now = new Date();
    const today = getDhakaDayBounds(now);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const [
      totalOrders,
      newOrders,
      pending,
      processing,
      readyToShip,
      inTransit,
      deliveredToday,
      cancelled,
      failedDeliveries,
      returned,
      codPending,
      currentTotal,
      previousTotal,
      currentNew,
      previousNew,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.NEW } }),
      this.prisma.order.count({ where: { status: OrderStatus.PENDING } }),
      this.prisma.order.count({ where: { status: OrderStatus.PROCESSING } }),
      this.prisma.order.count({
        where: { deliveryStatus: DeliveryStatus.READY_TO_SHIP },
      }),
      this.prisma.order.count({
        where: { deliveryStatus: DeliveryStatus.IN_TRANSIT },
      }),
      this.prisma.order.count({
        where: {
          deliveryStatus: DeliveryStatus.DELIVERED,
          deliveredAt: { gte: today.start, lt: today.end },
        },
      }),
      this.prisma.order.count({ where: { status: OrderStatus.CANCELLED } }),
      this.prisma.order.count({
        where: { deliveryStatus: DeliveryStatus.FAILED },
      }),
      this.prisma.order.count({
        where: {
          OR: [
            { status: OrderStatus.RETURNED },
            { deliveryStatus: DeliveryStatus.RETURNED },
          ],
        },
      }),
      this.prisma.order.aggregate({
        where: {
          paymentMethod: PaymentMethod.COD,
          dueAmount: { gt: new Prisma.Decimal(0) },
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.RETURNED] },
        },
        _sum: { dueAmount: true },
      }),
      this.prisma.order.count({
        where: { placedAt: { gte: sevenDaysAgo, lte: now } },
      }),
      this.prisma.order.count({
        where: { placedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.NEW,
          placedAt: { gte: sevenDaysAgo, lte: now },
        },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.NEW,
          placedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
        },
      }),
    ]);

    return {
      totalOrders,
      newOrders,
      pending,
      processing,
      readyToShip,
      inTransit,
      deliveredToday,
      cancelled,
      failedDeliveries,
      returned,
      codPendingAmount: codPending._sum.dueAmount ?? new Prisma.Decimal(0),
      changeVsPrevious7Days: {
        totalOrdersPercent: percentChange(currentTotal, previousTotal),
        newOrdersPercent: percentChange(currentNew, previousNew),
      },
    };
  }

  async getById(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: orderDetailSelect,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async updateStatus(
    staffId: string,
    orderId: string,
    input: UpdateOrderStatusDTO,
  ) {
    if (input.status === undefined && input.deliveryStatus === undefined) {
      throw new BadRequestException(
        'status or deliveryStatus must be provided',
      );
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNo: true,
          status: true,
          deliveryStatus: true,
          paymentMethod: true,
          paymentStatus: true,
          paidAmount: true,
          dueAmount: true,
          total: true,
          cancelledAt: true,
          orderItems: { select: { bookId: true, quantity: true } },
        },
      });
      if (!current) throw new NotFoundException('Order not found');

      let nextDeliveryStatus = input.deliveryStatus ?? current.deliveryStatus;
      let nextStatus = input.status ?? current.status;

      if (input.status === OrderStatus.COMPLETED) {
        if (input.deliveryStatus !== DeliveryStatus.DELIVERED) {
          throw new BadRequestException(
            'Orders can only be completed by marking delivery as delivered',
          );
        }
      } else if (
        input.status !== undefined &&
        input.status !== current.status &&
        !orderStatusTransitions[current.status].includes(input.status)
      ) {
        throw new BadRequestException(
          `Cannot change order status from ${current.status} to ${input.status}`,
        );
      }

      if (
        input.status === OrderStatus.CANCELLED &&
        input.deliveryStatus !== undefined
      ) {
        throw new BadRequestException(
          'Cancellation cannot be combined with a delivery status change',
        );
      }

      if (input.status === OrderStatus.RETURNED) {
        if (
          input.deliveryStatus !== undefined &&
          input.deliveryStatus !== DeliveryStatus.RETURNED
        ) {
          throw new BadRequestException(
            'A returned order must use deliveryStatus RETURNED',
          );
        }
        nextDeliveryStatus = DeliveryStatus.RETURNED;
      }

      if (input.deliveryStatus === DeliveryStatus.RETURNED) {
        if (
          input.status !== undefined &&
          input.status !== OrderStatus.RETURNED
        ) {
          throw new BadRequestException(
            'A returned delivery cannot use a different order status',
          );
        }
        nextStatus = OrderStatus.RETURNED;
      } else if (input.deliveryStatus === DeliveryStatus.DELIVERED) {
        if (
          input.status !== undefined &&
          input.status !== OrderStatus.COMPLETED
        ) {
          throw new BadRequestException(
            'A delivered order must transition to COMPLETED',
          );
        }
        nextStatus = OrderStatus.COMPLETED;
      }

      if (nextDeliveryStatus !== current.deliveryStatus) {
        if (
          !deliveryStatusTransitions[current.deliveryStatus].includes(
            nextDeliveryStatus,
          )
        ) {
          throw new BadRequestException(
            `Cannot change delivery status from ${current.deliveryStatus} to ${nextDeliveryStatus}`,
          );
        }
      }

      if (
        nextDeliveryStatus === DeliveryStatus.READY_TO_SHIP &&
        nextStatus !== OrderStatus.PROCESSING
      ) {
        throw new BadRequestException(
          'The order must be PROCESSING before it is ready to ship',
        );
      }

      const now = new Date();
      const completingWithCod =
        nextDeliveryStatus === DeliveryStatus.DELIVERED &&
        current.deliveryStatus !== DeliveryStatus.DELIVERED &&
        current.paymentMethod === PaymentMethod.COD &&
        current.dueAmount.greaterThan(0);
      const updateData: Prisma.OrderUpdateManyMutationInput = {
        status: nextStatus,
        deliveryStatus: nextDeliveryStatus,
        ...(nextStatus === OrderStatus.CANCELLED
          ? { cancelledAt: current.cancelledAt ?? now }
          : {}),
        ...(nextDeliveryStatus === DeliveryStatus.DELIVERED
          ? { deliveredAt: now }
          : {}),
        ...(completingWithCod
          ? {
              paidAmount: { increment: current.dueAmount },
              dueAmount: new Prisma.Decimal(0),
              paymentStatus: PaymentStatus.PAID,
            }
          : {}),
      };

      const updated = await transaction.order.updateMany({
        where: {
          id: current.id,
          status: current.status,
          deliveryStatus: current.deliveryStatus,
          dueAmount: current.dueAmount,
        },
        data: updateData,
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'The order status changed; refresh and try again',
        );
      }

      if (completingWithCod) {
        await transaction.payment.create({
          data: {
            orderId,
            amount: current.dueAmount,
            method: PaymentMethod.COD,
            receivedById: staffId,
          },
        });
      }

      await transaction.orderStatusHistory.create({
        data: {
          orderId,
          status: nextStatus,
          deliveryStatus: nextDeliveryStatus,
          note: input.note,
          changedById: staffId,
        },
      });

      const isReversal =
        nextStatus === OrderStatus.CANCELLED ||
        nextStatus === OrderStatus.RETURNED;
      if (isReversal) {
        for (const item of current.orderItems) {
          await this.stockService.applyMovement(transaction, {
            bookId: item.bookId,
            type: StockMovementType.RETURN,
            quantity: item.quantity,
            orderId,
            userId: staffId,
            note:
              nextStatus === OrderStatus.CANCELLED
                ? 'Order cancelled'
                : 'Order returned',
          });
        }
      }

      const order = await transaction.order.findUniqueOrThrow({
        where: { id: orderId },
        select: orderDetailSelect,
      });
      return {
        order,
        emitCompleted:
          current.status !== OrderStatus.COMPLETED &&
          nextStatus === OrderStatus.COMPLETED,
        emitReversed: current.status === OrderStatus.COMPLETED && isReversal,
      };
    });

    if (result.emitCompleted) {
      this.eventEmitter.emit('order.completed', { orderId });
    }
    if (result.emitReversed) {
      this.eventEmitter.emit('order.reversed', { orderId });
    }
    return result.order;
  }

  async assignCourier(orderId: string, input: AssignCourierDTO) {
    const [order, courier] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true },
      }),
      this.prisma.courier.findUnique({
        where: { id: input.courierId },
        select: { id: true, isActive: true },
      }),
    ]);
    if (!order) throw new NotFoundException('Order not found');
    if (!courier || !courier.isActive) {
      throw new NotFoundException('Active courier not found');
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        courierId: courier.id,
        ...(input.trackingNo !== undefined
          ? { trackingNo: input.trackingNo }
          : {}),
      },
      select: { id: true, orderNo: true, courierId: true, trackingNo: true },
    });
  }

  async assignStaff(orderId: string, staffId: string) {
    const [order, staff] = await Promise.all([
      this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: {
          id: staffId,
          status: UserStatus.ACTIVE,
          role: {
            in: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.WORKER],
          },
        },
        select: { id: true },
      }),
    ]);
    if (!order) throw new NotFoundException('Order not found');
    if (!staff) throw new NotFoundException('Active staff user not found');
    return this.prisma.order.update({
      where: { id: orderId },
      data: { staffId },
      select: { id: true, orderNo: true, staffId: true },
    });
  }

  async collectPayment(
    staffId: string,
    orderId: string,
    input: AdminPaymentDTO,
  ) {
    const amount = new Prisma.Decimal(input.amount.toString());
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNo: true,
          paidAmount: true,
          dueAmount: true,
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      if (amount.greaterThan(order.dueAmount)) {
        throw new BadRequestException('Payment amount exceeds the order due');
      }

      const result = await transaction.order.updateMany({
        where: { id: orderId, dueAmount: { gte: amount } },
        data: {
          paidAmount: { increment: amount },
          dueAmount: { decrement: amount },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'The order due changed; refresh and try again',
        );
      }
      const amounts = await transaction.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { paidAmount: true, dueAmount: true },
      });
      const updatedOrder = await transaction.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: paymentStatusFor(
            amounts.paidAmount,
            amounts.dueAmount,
          ),
        },
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

  async getOrderIssues(query: AdminOrderIssuesQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.OrderIssueWhereInput = query.status
      ? { status: query.status }
      : {};
    const [issues, total] = await Promise.all([
      this.prisma.orderIssue.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          details: true,
          status: true,
          resolution: true,
          createdAt: true,
          updatedAt: true,
          order: { select: { id: true, orderNo: true, channel: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.orderIssue.count({ where }),
    ]);
    return {
      data: issues,
      meta: pageMeta(page, limit, total),
    };
  }

  async updateOrderIssue(issueId: string, input: UpdateOrderIssueDTO) {
    const exists = await this.prisma.orderIssue.findUnique({
      where: { id: issueId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Order issue not found');
    return this.prisma.orderIssue.update({
      where: { id: issueId },
      data: { status: input.status, resolution: input.resolution },
      select: {
        id: true,
        orderId: true,
        status: true,
        resolution: true,
        updatedAt: true,
      },
    });
  }

  async exportCsv(query: AdminOrdersQueryDTO) {
    this.validateDateRange(query.from, query.to);
    const where = this.buildWhere(query);
    const orders = await this.prisma.order.findMany({
      where,
      orderBy:
        query.sort === 'total'
          ? [{ total: 'desc' }, { placedAt: 'desc' }]
          : { placedAt: 'desc' },
      select: orderListSelect,
    });
    const copyCounts = await this.getCopyCounts(
      orders.map((order) => order.id),
    );
    const header = [
      'Order No',
      'Channel',
      'Customer',
      'Shop',
      'Phone',
      'Item Count',
      'Copies',
      'Total',
      'Payment Status',
      'Order Status',
      'Delivery Status',
      'Placed At',
      'Courier',
      'Tracking No',
    ];
    const rows = orders.map((order) =>
      [
        order.orderNo,
        order.channel,
        order.customer?.name ?? '',
        order.shop?.name ?? '',
        order.customer?.phone ?? order.shop?.phone ?? '',
        order._count.orderItems,
        copyCounts.get(order.id) ?? 0,
        order.total.toString(),
        order.paymentStatus,
        order.status,
        order.deliveryStatus,
        order.placedAt.toISOString(),
        order.courier?.name ?? '',
        order.trackingNo ?? '',
      ]
        .map((value) => csvCell(value))
        .join(','),
    );
    const csv = `\uFEFF${[header.map(csvCell).join(','), ...rows].join('\r\n')}`;
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="orders.csv"',
    });
  }

  private buildWhere(query: AdminOrdersQueryDTO): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.orderStatus ? { status: query.orderStatus } : {}),
      ...(query.deliveryStatus ? { deliveryStatus: query.deliveryStatus } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.courierId ? { courierId: query.courierId } : {}),
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.from || query.to
        ? {
            placedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.district
        ? {
            OR: [
              {
                shipDistrict: {
                  contains: query.district,
                  mode: 'insensitive',
                },
              },
              {
                shop: {
                  is: {
                    district: {
                      contains: query.district,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    if (query.search) {
      const searchConditions: Prisma.OrderWhereInput[] = [
        { orderNo: { contains: query.search, mode: 'insensitive' } },
        { trackingNo: { contains: query.search, mode: 'insensitive' } },
        {
          customer: {
            is: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          shop: {
            is: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
      where.AND = [
        ...((where.AND as Prisma.OrderWhereInput[] | undefined) ?? []),
        { OR: searchConditions },
      ];
    }
    return where;
  }

  private validateDateRange(from?: Date, to?: Date) {
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from cannot be later than to');
    }
  }

  private async getCopyCounts(orderIds: string[]) {
    if (orderIds.length === 0) return new Map<string, number>();
    const groups = await this.prisma.orderItem.groupBy({
      by: ['orderId'],
      where: { orderId: { in: orderIds } },
      _sum: { quantity: true },
    });
    return new Map(
      groups.map((group) => [group.orderId, group._sum.quantity ?? 0]),
    );
  }
}
