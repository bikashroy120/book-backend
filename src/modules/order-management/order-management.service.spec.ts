import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { StockService } from '../stock/stock.service';
import { OrderManagementService } from './order-management.service';

describe('OrderManagementService status transitions', () => {
  function makeService(
    current: Record<string, unknown>,
    updated: Record<string, unknown> = {},
  ) {
    let orderUpdateArgs: Prisma.OrderUpdateManyArgs | undefined;
    const transaction = {
      order: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest
          .fn()
          .mockImplementation((args: Prisma.OrderUpdateManyArgs) => {
            orderUpdateArgs = args;
            return Promise.resolve({ count: 1 });
          }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
      payment: { create: jest.fn().mockResolvedValue({ id: 'payment-1' }) },
      orderStatusHistory: {
        create: jest.fn().mockResolvedValue({ id: 'history-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const applyMovement = jest.fn().mockResolvedValue({});
    const emit = jest.fn();
    return {
      service: new OrderManagementService(
        prisma,
        { applyMovement } as unknown as StockService,
        { emit } as unknown as EventEmitter2,
      ),
      transaction,
      applyMovement,
      emit,
      getOrderUpdateArgs: () => orderUpdateArgs,
    };
  }

  it('rejects completing an order without a delivered transition', async () => {
    const { service, transaction } = makeService({
      id: 'order-1',
      status: OrderStatus.PROCESSING,
      deliveryStatus: DeliveryStatus.IN_TRANSIT,
      paymentMethod: PaymentMethod.COD,
      paidAmount: new Prisma.Decimal(0),
      dueAmount: new Prisma.Decimal(100),
      orderItems: [],
    });

    await expect(
      service.updateStatus('staff-1', 'order-1', {
        status: OrderStatus.COMPLETED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it('settles COD on delivery and emits completion after the transaction', async () => {
    const { service, transaction, emit, getOrderUpdateArgs } = makeService(
      {
        id: 'order-1',
        orderNo: 'ORD-1',
        status: OrderStatus.PROCESSING,
        deliveryStatus: DeliveryStatus.IN_TRANSIT,
        paymentMethod: PaymentMethod.COD,
        paymentStatus: PaymentStatus.UNPAID,
        paidAmount: new Prisma.Decimal(0),
        dueAmount: new Prisma.Decimal('120.50'),
        total: new Prisma.Decimal('120.50'),
        cancelledAt: null,
        orderItems: [],
      },
      { id: 'order-1', status: OrderStatus.COMPLETED },
    );

    await expect(
      service.updateStatus('staff-1', 'order-1', {
        deliveryStatus: DeliveryStatus.DELIVERED,
      }),
    ).resolves.toMatchObject({ status: OrderStatus.COMPLETED });
    expect(transaction.payment.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        amount: new Prisma.Decimal('120.50'),
        method: PaymentMethod.COD,
        receivedById: 'staff-1',
      },
    });
    expect(getOrderUpdateArgs()?.data).toMatchObject({
      status: OrderStatus.COMPLETED,
      deliveryStatus: DeliveryStatus.DELIVERED,
      paymentStatus: PaymentStatus.PAID,
    });
    expect(emit).toHaveBeenCalledWith('order.completed', {
      orderId: 'order-1',
    });
  });

  it('restores stock and emits reversal when a completed order is returned', async () => {
    const { service, applyMovement, emit } = makeService(
      {
        id: 'order-1',
        orderNo: 'ORD-1',
        status: OrderStatus.COMPLETED,
        deliveryStatus: DeliveryStatus.DELIVERED,
        paymentMethod: PaymentMethod.COD,
        paymentStatus: PaymentStatus.PAID,
        paidAmount: new Prisma.Decimal(50),
        dueAmount: new Prisma.Decimal(0),
        total: new Prisma.Decimal(50),
        cancelledAt: null,
        orderItems: [{ bookId: 'book-1', quantity: 2 }],
      },
      { id: 'order-1', status: OrderStatus.RETURNED },
    );

    await service.updateStatus('staff-1', 'order-1', {
      deliveryStatus: DeliveryStatus.RETURNED,
    });

    expect(applyMovement).toHaveBeenCalledWith(expect.anything(), {
      bookId: 'book-1',
      type: StockMovementType.RETURN,
      quantity: 2,
      orderId: 'order-1',
      userId: 'staff-1',
      note: 'Order returned',
    });
    expect(emit).toHaveBeenCalledWith('order.reversed', {
      orderId: 'order-1',
    });
  });
});
