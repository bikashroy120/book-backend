import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { DeliveryChargeService } from './delivery-charge.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StockModule],
  controllers: [OrdersController],
  providers: [OrdersService, DeliveryChargeService],
  exports: [OrdersService, DeliveryChargeService],
})
export class OrdersModule {}
