import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { BookStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { rm } from 'node:fs/promises';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptor/transform.interceptor';
import type { AuthUser } from '../src/common/types/auth-user';
import { PrismaService } from '../src/core/database/prisma.service';
import { BooksService } from '../src/modules/books/books.service';
import type { CreateBookDTO } from '../src/modules/books/dto/create-book.dto';
import type { ChangeBookStatusDTO } from '../src/modules/books/dto/change-book-status.dto';
import { OrdersService } from '../src/modules/orders/orders.service';
import type { CreateOrderDTO } from '../src/modules/orders/dto/create-order.dto';
import { CounterOrdersService } from '../src/modules/counter-orders/counter-orders.service';
import type { CreateCounterOrderDTO } from '../src/modules/counter-orders/dto/create-counter-order.dto';
import { calcCounterTotals } from '../src/modules/counter-orders/counter-orders.service';
import { RoyaltyService } from '../src/modules/royalties/royalty.service';
import type { RequestPayoutDTO } from '../src/modules/royalties/dto/request-payout.dto';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import type { CreateReviewDTO } from '../src/modules/reviews/dto/create-review.dto';

type WorkflowBook = {
  id: string;
  title: string;
  slug: string;
  status: BookStatus;
  price: number;
  salePrice: string;
  discountPercent: number;
  stock: number;
};

type WorkflowOrder = {
  id: string;
  status: 'NEW' | 'CANCELLED';
  quantity: number;
  unitPrice: string;
};

describe('Business workflow HTTP contracts (e2e)', () => {
  let app: NestExpressApplication<App>;
  let book: WorkflowBook;
  let onlineOrder: WorkflowOrder | undefined;
  let hasEligibleReviewOrder = false;

  const resetState = () => {
    book = {
      id: 'workflow-book',
      title: 'Workflow Book',
      slug: 'workflow-book',
      status: BookStatus.DRAFT,
      price: 100,
      salePrice: '80.00',
      discountPercent: 20,
      stock: 5,
    };
    onlineOrder = undefined;
    hasEligibleReviewOrder = false;
  };

  const booksService = {
    create: (_editor: AuthUser, input: CreateBookDTO) => {
      const price = new Prisma.Decimal(input.price);
      const discount = new Prisma.Decimal(input.discountPercent);
      book = {
        ...book,
        title: input.title,
        slug: 'workflow-book',
        status: input.status,
        price: input.price,
        discountPercent: input.discountPercent,
        salePrice: price
          .minus(price.mul(discount).div(100).toDecimalPlaces(2))
          .toFixed(2),
        stock: input.stock,
      };
      return Promise.resolve(book);
    },
    changeStatus: (
      _editor: AuthUser,
      id: string,
      input: ChangeBookStatusDTO,
    ) => {
      if (id !== book.id) throw new BadRequestException('Book not found');
      book.status = input.status;
      return Promise.resolve(book);
    },
    findStoreBooks: () =>
      Promise.resolve({
        data: book.status === BookStatus.PUBLISHED ? [book] : [],
        meta: {
          page: 1,
          limit: 20,
          total: book.status === BookStatus.PUBLISHED ? 1 : 0,
        },
      }),
  };

  const ordersService = {
    create: (userId: string, input: CreateOrderDTO) => {
      const quantity = input.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      if (book.status !== BookStatus.PUBLISHED || quantity > book.stock) {
        throw new BadRequestException(
          'Book is not available in the requested quantity',
        );
      }
      book.stock -= quantity;
      onlineOrder = {
        id: 'workflow-order',
        status: 'NEW',
        quantity,
        unitPrice: book.salePrice,
      };
      hasEligibleReviewOrder = true;
      return Promise.resolve({
        id: onlineOrder.id,
        customerId: userId,
        status: onlineOrder.status,
        total: new Prisma.Decimal(book.salePrice).mul(quantity).toFixed(2),
        orderItems: [
          {
            titleSnapshot: book.title,
            unitPrice: book.salePrice,
            quantity,
          },
        ],
      });
    },
    cancel: (userId: string, id: string) => {
      if (
        !onlineOrder ||
        onlineOrder.id !== id ||
        onlineOrder.status !== 'NEW'
      ) {
        throw new BadRequestException('Order cannot be cancelled');
      }
      book.stock += onlineOrder.quantity;
      onlineOrder.status = 'CANCELLED';
      hasEligibleReviewOrder = false;
      return Promise.resolve({
        id,
        status: onlineOrder.status,
        customerId: userId,
      });
    },
  };

  const counterOrdersService = {
    create: (_staffId: string, input: CreateCounterOrderDTO) => {
      const quantity = input.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      if (quantity > book.stock) {
        throw new BadRequestException('Insufficient stock');
      }
      const commissionRate = new Prisma.Decimal(input.commissionRate ?? 20);
      const totals = calcCounterTotals(
        [{ unitPrice: new Prisma.Decimal(book.salePrice), quantity }],
        commissionRate,
      );
      const paidAmount = new Prisma.Decimal(input.paidAmount);
      if (paidAmount.greaterThan(totals.total)) {
        throw new BadRequestException(
          'Paid amount cannot exceed the order total',
        );
      }
      book.stock -= quantity;
      const dueAmount = totals.total.minus(paidAmount);
      return Promise.resolve({
        id: 'workflow-counter-order',
        subtotal: totals.subtotal.toFixed(2),
        commissionAmount: totals.commissionAmount.toFixed(2),
        total: totals.total.toFixed(2),
        paidAmount: paidAmount.toFixed(2),
        dueAmount: dueAmount.toFixed(2),
        paymentStatus: dueAmount.isZero()
          ? PaymentStatus.PAID
          : paidAmount.isZero()
            ? PaymentStatus.UNPAID
            : PaymentStatus.PARTIAL,
      });
    },
  };

  const royaltyService = {
    requestPayout: (_userId: string, input: RequestPayoutDTO) => {
      if (input.amount > 500) {
        throw new BadRequestException('Amount exceeds available balance');
      }
      return Promise.resolve({ id: 'workflow-payout', amount: input.amount });
    },
  };

  const reviewsService = {
    create: (_userId: string, input: CreateReviewDTO) => {
      if (!hasEligibleReviewOrder) {
        throw new ForbiddenException(
          'A delivered or completed purchase is required',
        );
      }
      return Promise.resolve({
        id: 'workflow-review',
        bookId: input.bookId,
        isVerifiedPurchase: true,
        status: 'PENDING',
      });
    },
  };

  const accessTokenFor = (role: UserRole) =>
    app.get(JwtService).sign(
      {
        sub: `workflow-${role.toLowerCase()}`,
        email: 'workflow@example.com',
        role,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );

  beforeAll(async () => {
    resetState();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(BooksService)
      .useValue(booksService)
      .overrideProvider(OrdersService)
      .useValue(ordersService)
      .overrideProvider(CounterOrdersService)
      .useValue(counterOrdersService)
      .overrideProvider(RoyaltyService)
      .useValue(royaltyService)
      .overrideProvider(ReviewsService)
      .useValue(reviewsService)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    const uploadDirectory = process.env.UPLOAD_DIR;
    if (uploadDirectory) {
      await rm(uploadDirectory, { recursive: true, force: true });
    }
  });

  beforeEach(resetState);

  it('requires staff for book management while allowing a public store listing', async () => {
    await request(app.getHttpServer()).get('/api/v1/books').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/books')
      .set('Authorization', `Bearer ${accessTokenFor(UserRole.USER)}`)
      .expect(403);

    const response = await request(app.getHttpServer())
      .get('/api/v1/store/books')
      .expect(200);
    expect(response.text).toContain('"data":[]');
  });

  it('publishes a book and exposes the server-computed sale price in the store', async () => {
    const staffToken = accessTokenFor(UserRole.ADMIN);
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/books')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        title: 'Workflow Book',
        categoryId: 'category-1',
        publisherId: 'publisher-1',
        authorName: 'Workflow Author',
        coverType: 'PAPERBACK',
        price: 100,
        discountPercent: 20,
        salePrice: 1,
        stock: 5,
        status: 'DRAFT',
      })
      .expect(201);
    expect(createResponse.text).toContain('"salePrice":"80.00"');

    await request(app.getHttpServer())
      .patch('/api/v1/books/workflow-book/status')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'PUBLISHED' })
      .expect(200);

    const storeResponse = await request(app.getHttpServer())
      .get('/api/v1/store/books')
      .expect(200);
    expect(storeResponse.text).toContain('"salePrice":"80.00"');
  });

  it('places an order at the server price and restores stock when cancelled', async () => {
    book.status = BookStatus.PUBLISHED;
    const customerToken = accessTokenFor(UserRole.USER);
    const created = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ bookId: book.id, quantity: 2 }],
        addressId: 'address-1',
        paymentMethod: 'COD',
      })
      .expect(201);

    expect(created.text).toContain('"unitPrice":"80.00"');
    expect(book.stock).toBe(3);

    await request(app.getHttpServer())
      .post('/api/v1/orders/me/workflow-order/cancel')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(201);
    expect(book.stock).toBe(5);
  });

  it('accepts a partially paid counter order and reports its due balance', async () => {
    book.status = BookStatus.PUBLISHED;
    const response = await request(app.getHttpServer())
      .post('/api/v1/counter-orders')
      .set('Authorization', `Bearer ${accessTokenFor(UserRole.WORKER)}`)
      .send({
        shopId: 'shop-1',
        items: [{ bookId: book.id, quantity: 1 }],
        commissionRate: 20,
        paidAmount: 20,
        paymentMethod: 'CASH',
      })
      .expect(201);

    expect(response.text).toContain('"total":"64.00"');
    expect(response.text).toContain('"dueAmount":"44.00"');
    expect(response.text).toContain(
      `"paymentStatus":"${PaymentStatus.PARTIAL}"`,
    );
  });

  it('rejects payout requests above the author available balance', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payouts')
      .set('Authorization', `Bearer ${accessTokenFor(UserRole.AUTHOR)}`)
      .send({ amount: 501, method: 'BKASH', accountNo: '01712345678' })
      .expect(400);
  });

  it('requires a qualifying purchase before accepting a review', async () => {
    const userToken = accessTokenFor(UserRole.USER);
    const review = {
      bookId: book.id,
      rating: 5,
      comment: 'This is a thoughtful book.',
    };
    await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send(review)
      .expect(403);

    hasEligibleReviewOrder = true;
    const response = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send(review)
      .expect(201);
    expect(response.text).toContain('"isVerifiedPurchase":true');
  });
});
