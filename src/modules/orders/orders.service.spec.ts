import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateOrderDTO } from './dto/create-order.dto';
import { CreateOrderIssueDTO } from './dto/create-order-issue.dto';
import { DeliveryChargeService } from './delivery-charge.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  function makeCreateService(stock: number) {
    const savedOrder = {
      id: 'order-1',
      orderNo: 'ORD-20261127-001',
      status: OrderStatus.NEW,
    };
    let orderCreateData: Prisma.OrderCreateArgs['data'] | undefined;
    const createOrder = jest
      .fn()
      .mockImplementation((input: { data: Prisma.OrderCreateArgs['data'] }) => {
        orderCreateData = input.data;
        return Promise.resolve({ id: 'order-1' });
      });
    const transaction = {
      address: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'address-1',
          fullName: 'Reader',
          phone: '01712345678',
          division: 'Dhaka',
          district: 'Dhaka',
          upazila: 'Dhanmondi',
          details: 'Road 1',
        }),
      },
      book: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'book-1',
            title: 'Book title',
            salePrice: new Prisma.Decimal('49.99'),
            stock,
          },
        ]),
      },
      setting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        create: createOrder,
        findUniqueOrThrow: jest.fn().mockResolvedValue(savedOrder),
      },
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
    const stockService = { applyMovement } as unknown as StockService;
    const emit = jest.fn();
    const eventEmitter = { emit } as unknown as EventEmitter2;
    const deliveryChargeService = new DeliveryChargeService(
      {} as PrismaService,
    );
    return {
      service: new OrdersService(
        prisma,
        stockService,
        deliveryChargeService,
        eventEmitter,
      ),
      transaction,
      applyMovement,
      emit,
      getOrderCreateData: () => orderCreateData,
    };
  }

  const orderInput: CreateOrderDTO = {
    addressId: 'address-1',
    paymentMethod: PaymentMethod.COD,
    items: [{ bookId: 'book-1', quantity: 2 }],
  };

  it('creates server-priced orders transactionally and emits after commit', async () => {
    const { service, transaction, applyMovement, emit, getOrderCreateData } =
      makeCreateService(4);

    await expect(service.create('reader-1', orderInput)).resolves.toMatchObject(
      {
        id: 'order-1',
      },
    );

    const createData = getOrderCreateData();
    expect(createData?.orderNo).toMatch(/^ORD-\d{8}-001$/);
    expect(createData).toMatchObject({
      channel: 'WEBSITE',
      customerId: 'reader-1',
      status: OrderStatus.NEW,
      deliveryStatus: DeliveryStatus.NOT_DISPATCHED,
      paymentStatus: 'UNPAID',
      paymentMethod: PaymentMethod.COD,
      shipName: 'Reader',
      shipPhone: '01712345678',
      shipAddress: 'Road 1, Dhanmondi, Dhaka, Dhaka',
      shipDistrict: 'Dhaka',
      subtotal: new Prisma.Decimal('99.98'),
      deliveryCharge: new Prisma.Decimal(60),
      total: new Prisma.Decimal('159.98'),
      dueAmount: new Prisma.Decimal('159.98'),
    });
    expect(createData).toMatchObject({
      orderItems: {
        create: [
          {
            titleSnapshot: 'Book title',
            unitPrice: new Prisma.Decimal('49.99'),
            quantity: 2,
            lineTotal: new Prisma.Decimal('99.98'),
            book: { connect: { id: 'book-1' } },
          },
        ],
      },
    });
    expect(applyMovement).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        bookId: 'book-1',
        type: StockMovementType.SALE,
        quantity: 2,
        orderId: 'order-1',
        userId: 'reader-1',
      }),
    );
    expect(transaction.orderStatusHistory.create).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('order.placed', {
      orderId: 'order-1',
    });
  });

  it('rejects insufficient stock before creating the order', async () => {
    const { service, transaction, applyMovement } = makeCreateService(1);

    await expect(service.create('reader-1', orderInput)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction.order.create).not.toHaveBeenCalled();
    expect(applyMovement).not.toHaveBeenCalled();
  });

  it('does not expose another customer’s order during cancellation', async () => {
    const transaction = {
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new OrdersService(
      prisma,
      {} as StockService,
      {} as DeliveryChargeService,
      {} as EventEmitter2,
    );

    await expect(
      service.cancel('reader-1', 'foreign-order'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.order.updateMany).not.toHaveBeenCalled();
  });

  it('cancels eligible orders and restores their stock in the same transaction', async () => {
    type CancellationUpdate = {
      where: {
        id: string;
        customerId: string;
        status: { in: OrderStatus[] };
      };
      data: { status: OrderStatus; cancelledAt: Date };
    };
    let cancellationUpdate: CancellationUpdate | undefined;
    const updateOrder = jest
      .fn()
      .mockImplementation((input: CancellationUpdate) => {
        cancellationUpdate = input;
        return Promise.resolve({ count: 1 });
      });
    const transaction = {
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'order-1',
          status: OrderStatus.PENDING,
          orderItems: [{ bookId: 'book-1', quantity: 2 }],
        }),
        updateMany: updateOrder,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'order-1',
          orderNo: 'ORD-20261127-001',
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
        }),
      },
      orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const applyMovement = jest.fn().mockResolvedValue({});
    const service = new OrdersService(
      prisma,
      { applyMovement } as unknown as StockService,
      {} as DeliveryChargeService,
      {} as EventEmitter2,
    );

    await service.cancel('reader-1', 'order-1');

    if (!cancellationUpdate) {
      throw new Error('Expected the cancellation update to be recorded');
    }
    expect(cancellationUpdate.where).toEqual({
      id: 'order-1',
      customerId: 'reader-1',
      status: { in: [OrderStatus.NEW, OrderStatus.PENDING] },
    });
    expect(cancellationUpdate.data.status).toBe(OrderStatus.CANCELLED);
    expect(cancellationUpdate.data.cancelledAt).toBeInstanceOf(Date);
    expect(applyMovement).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        bookId: 'book-1',
        type: StockMovementType.RETURN,
        quantity: 2,
        note: 'order cancelled',
        orderId: 'order-1',
        userId: 'reader-1',
      }),
    );
  });

  it('limits each order to three open issues', async () => {
    const createIssue = jest.fn();
    const transaction = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'order-1' }) },
      orderIssue: {
        count: jest.fn().mockResolvedValue(3),
        create: createIssue,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new OrdersService(
      prisma,
      {} as StockService,
      {} as DeliveryChargeService,
      {} as EventEmitter2,
    );
    const input: CreateOrderIssueDTO = {
      subject: 'Issue subject',
      details: 'Issue details',
    };

    await expect(
      service.createIssue('reader-1', 'order-1', input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(createIssue).not.toHaveBeenCalled();
  });
});
