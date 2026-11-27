import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validate } from './core/config/env.validation';
import { PrismaModule } from './core/database/prisma.module';
import { MailModule } from './core/mail/mail.module';
import { UploadModule } from './core/storage/upload.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AuthorsModule } from './modules/authors/authors.module';
import { PublishersModule } from './modules/publishers/publishers.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { BooksModule } from './modules/books/books.module';
import { StockModule } from './modules/stock/stock.module';
import { ShopsModule } from './modules/shops/shops.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CounterOrdersModule } from './modules/counter-orders/counter-orders.module';
import { OrderManagementModule } from './modules/order-management/order-management.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    JwtModule.register({ global: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    MailModule,
    UploadModule,
    AuthModule,
    UsersModule,
    AddressesModule,
    AuthorsModule,
    PublishersModule,
    CategoriesModule,
    BooksModule,
    StockModule,
    ShopsModule,
    OrdersModule,
    CounterOrdersModule,
    OrderManagementModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
