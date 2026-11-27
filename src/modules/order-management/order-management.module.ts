import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { CouriersController } from './couriers.controller';
import {
  AdminOrderIssuesController,
  OrderManagementController,
} from './order-management.controller';
import { CouriersService } from './couriers.service';
import { OrderManagementService } from './order-management.service';

@Module({
  imports: [StockModule],
  controllers: [
    OrderManagementController,
    CouriersController,
    AdminOrderIssuesController,
  ],
  providers: [OrderManagementService, CouriersService],
})
export class OrderManagementModule {}
