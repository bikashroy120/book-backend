import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import {
  CreateOrderIssueDTO,
  OrderIssuesQueryDTO,
} from './dto/create-order-issue.dto';
import { CreateOrderDTO } from './dto/create-order.dto';
import { OrdersQueryDTO } from './dto/orders-query.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@Roles(UserRole.USER)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: CreateOrderDTO) {
    return this.ordersService.create(user.id, input);
  }

  @Get('me')
  findMine(@CurrentUser() user: AuthUser, @Query() query: OrdersQueryDTO) {
    return this.ordersService.findMine(user.id, query);
  }

  @Get('me/issues')
  getMyIssues(
    @CurrentUser() user: AuthUser,
    @Query() query: OrderIssuesQueryDTO,
  ) {
    return this.ordersService.getMyIssues(user.id, query);
  }

  @Get('me/:id/track')
  getTrack(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ordersService.getTrack(user.id, id);
  }

  @Get('me/:id')
  getMineById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ordersService.getMineById(user.id, id);
  }

  @Post('me/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ordersService.cancel(user.id, id);
  }

  @Post('me/:id/issues')
  createIssue(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: CreateOrderIssueDTO,
  ) {
    return this.ordersService.createIssue(user.id, id, input);
  }
}
