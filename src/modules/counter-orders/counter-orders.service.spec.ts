import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  StockMovementType,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { StockService } from '../stock/stock.service';
import { AddCounterPaymentDTO } from './dto/add-counter-payment.dto';
import { CreateCounterOrderDTO } from './dto/create-counter-order.dto';
import {
  calcCounterTotals,
  CounterOrdersService,
} from './counter-orders.service';

describe('CounterOrdersService', () => {
  function makeCreateService() {
    let orderCreateData: Prisma.OrderCreateArgs['data'] | undefined;
    let paymentCreateData: Prisma.PaymentCreateArgs['data'] | undefined;
    const createOrder = jest
      .fn()
      .mockImplementation((input: { data: Prisma.OrderCreateArgs['data'] }) => {
        orderCreateData = input.data;
        return Promise.resolve({ id: 'counter-order-1' });
      });
    const createPayment = jest
      .fn()
      .mockImplementation(
        (input: { data: Prisma.PaymentCreateArgs['data'] }) => {
          paymentCreateData = input.data;
          return Promise.resolve({ id: 'payment-1' });
        },
      );
    const transaction = {
      shop: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'shop-1',
          status: UserStatus.ACTIVE,
          commissionRate: new Prisma.Decimal(30),
        }),
      },
      book: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'book-1',
            title: 'Book title',
            salePrice: new Prisma.Decimal(100),
            stock: 5,
          },
        ]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        create: createOrder,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'counter-order-1',
          orderNo: 'CNT-20261127-001',
          status: OrderStatus.COMPLETED,
        }),
      },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      payment: { create: createPayment },
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
      service: new CounterOrdersService(
        prisma,
        { applyMovement } as unknown as StockService,
        { emit } as unknown as EventEmitter2,
      ),
      transaction,
      applyMovement,
      emit,
      getOrderCreateData: () => orderCreateData,
      getPaymentCreateData: () => paymentCreateData,
    };
  }

  it('calculates commission and net total using Decimal arithmetic', () => {
    expect(
      calcCounterTotals(
        [
          { unitPrice: new Prisma.Decimal('99.99'), quantity: 2 },
          { unitPrice: new Prisma.Decimal('10.00'), quantity: 1 },
        ],
        new Prisma.Decimal(35),
      ),
    ).toEqual({
      subtotal: new Prisma.Decimal('209.98'),
      commissionAmount: new Prisma.Decimal('73.49'),
      total: new Prisma.Decimal('136.49'),
    });
  });

  it('creates a completed counter order, records payment, decrements stock, and emits', async () => {
    const {
      service,
      transaction,
      applyMovement,
      emit,
      getOrderCreateData,
      getPaymentCreateData,
    } = makeCreateService();
    const input: CreateCounterOrderDTO = {
      shopId: 'shop-1',
      repName: 'Sales rep',
      items: [{ bookId: 'book-1', quantity: 2 }],
      commissionRate: 30,
      paidAmount: 20,
      paymentMethod: PaymentMethod.CASH,
      note: 'Memo note',
    };

    await expect(service.create('staff-1', input)).resolves.toMatchObject({
      id: 'counter-order-1',
    });

    const orderData = getOrderCreateData();
    expect(orderData?.orderNo).toMatch(/^CNT-\d{8}-001$/);
    expect(orderData).toMatchObject({
      channel: 'COUNTER',
      shopId: 'shop-1',
      staffId: 'staff-1',
      status: OrderStatus.COMPLETED,
      deliveryStatus: DeliveryStatus.COUNTER_HANDOVER,
      paymentStatus: PaymentStatus.PARTIAL,
      commissionRate: new Prisma.Decimal(30),
      subtotal: new Prisma.Decimal(200),
      commissionAmount: new Prisma.Decimal(60),
      total: new Prisma.Decimal(140),
      paidAmount: new Prisma.Decimal(20),
      dueAmount: new Prisma.Decimal(120),
      orderItems: {
        create: [
          {
            titleSnapshot: 'Book title',
            unitPrice: new Prisma.Decimal(100),
            quantity: 2,
            lineTotal: new Prisma.Decimal(200),
          },
        ],
      },
    });
    expect(getPaymentCreateData()).toMatchObject({
      amount: new Prisma.Decimal(20),
      method: PaymentMethod.CASH,
    });
    expect(applyMovement).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        bookId: 'book-1',
        type: StockMovementType.SALE,
        quantity: 2,
        orderId: 'counter-order-1',
        userId: 'staff-1',
      }),
    );
    expect(transaction.orderStatusHistory.create).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('order.completed', {
      orderId: 'counter-order-1',
    });
  });

  it('rejects initial payment above the calculated total', async () => {
    const { service, transaction, applyMovement } = makeCreateService();

    await expect(
      service.create('staff-1', {
        shopId: 'shop-1',
        items: [{ bookId: 'book-1', quantity: 2 }],
        commissionRate: 30,
        paidAmount: 141,
        paymentMethod: PaymentMethod.CASH,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.order.create).not.toHaveBeenCalled();
    expect(applyMovement).not.toHaveBeenCalled();
  });

  it('collects an additional payment and recomputes payment status', async () => {
    let paymentData: Prisma.PaymentCreateArgs['data'] | undefined;
    const createPayment = jest
      .fn()
      .mockImplementation(
        (input: { data: Prisma.PaymentCreateArgs['data'] }) => {
          paymentData = input.data;
          return Promise.resolve({ id: 'payment-2' });
        },
      );
    const transaction = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'counter-order-1',
          paidAmount: new Prisma.Decimal(20),
          dueAmount: new Prisma.Decimal(80),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          paidAmount: new Prisma.Decimal(50),
          dueAmount: new Prisma.Decimal(50),
        }),
        update: jest.fn().mockResolvedValue({
          id: 'counter-order-1',
          paymentStatus: PaymentStatus.PARTIAL,
        }),
      },
      payment: { create: createPayment },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CounterOrdersService(
      prisma,
      {} as StockService,
      {} as EventEmitter2,
    );
    const input: AddCounterPaymentDTO = {
      amount: 30,
      method: PaymentMethod.BKASH,
      transactionId: 'TX-123',
    };

    const result = await service.collectPayment(
      'staff-1',
      'counter-order-1',
      input,
    );

    expect(transaction.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'counter-order-1',
          channel: 'COUNTER',
          dueAmount: { gte: new Prisma.Decimal(30) },
        },
        data: {
          paidAmount: { increment: new Prisma.Decimal(30) },
          dueAmount: { decrement: new Prisma.Decimal(30) },
        },
      }),
    );
    expect(paymentData).toMatchObject({
      amount: new Prisma.Decimal(30),
      method: PaymentMethod.BKASH,
      transactionId: 'TX-123',
    });
    expect(result.order.paymentStatus).toBe(PaymentStatus.PARTIAL);
  });

  it('rejects payments larger than the current due', async () => {
    const transaction = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'counter-order-1',
          paidAmount: new Prisma.Decimal(20),
          dueAmount: new Prisma.Decimal(10),
        }),
        updateMany: jest.fn(),
      },
      payment: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CounterOrdersService(
      prisma,
      {} as StockService,
      {} as EventEmitter2,
    );

    await expect(
      service.collectPayment('staff-1', 'counter-order-1', {
        amount: 20,
        method: PaymentMethod.CASH,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
    expect(transaction.payment.create).not.toHaveBeenCalled();
  });
});
