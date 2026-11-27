import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { STAFF_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AddCounterPaymentDTO } from './dto/add-counter-payment.dto';
import { CreateCounterOrderDTO } from './dto/create-counter-order.dto';
import { CounterOrdersQueryDTO } from './dto/counter-orders-query.dto';
import { CounterOrdersService } from './counter-orders.service';

@Controller('counter-orders')
@Roles(...STAFF_ROLES)
export class CounterOrdersController {
  constructor(private readonly counterOrdersService: CounterOrdersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: CreateCounterOrderDTO) {
    return this.counterOrdersService.create(user.id, input);
  }

  @Post(':id/payments')
  collectPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: AddCounterPaymentDTO,
  ) {
    return this.counterOrdersService.collectPayment(user.id, id, input);
  }

  @Get()
  findAll(@Query() query: CounterOrdersQueryDTO) {
    return this.counterOrdersService.findAll(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.counterOrdersService.getById(id);
  }
}
