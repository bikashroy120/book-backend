import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { CounterOrdersController } from './counter-orders.controller';
import { CounterOrdersService } from './counter-orders.service';

@Module({
  imports: [StockModule],
  controllers: [CounterOrdersController],
  providers: [CounterOrdersService],
})
export class CounterOrdersModule {}
