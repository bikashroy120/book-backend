import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { STAFF_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AdminOrdersQueryDTO } from './dto/admin-orders-query.dto';
import { AdminPaymentDTO } from './dto/admin-payment.dto';
import { AssignCourierDTO, AssignStaffDTO } from './dto/assign-order.dto';
import { AdminOrderIssuesQueryDTO } from './dto/order-issues-query.dto';
import { UpdateOrderIssueDTO } from './dto/update-order-issue.dto';
import { UpdateOrderStatusDTO } from './dto/update-order-status.dto';
import { OrderManagementService } from './order-management.service';

@Controller('admin/orders')
@Roles(...STAFF_ROLES)
export class OrderManagementController {
  constructor(
    private readonly orderManagementService: OrderManagementService,
  ) {}

  @Get('stats')
  getStats() {
    return this.orderManagementService.getStats();
  }

  @Get('export.csv')
  exportCsv(@Query() query: AdminOrdersQueryDTO) {
    return this.orderManagementService.exportCsv(query);
  }

  @Get()
  findAll(@Query() query: AdminOrdersQueryDTO) {
    return this.orderManagementService.findAll(query);
  }

  @Get(':id/invoice')
  getInvoice(@Param('id') id: string) {
    return this.orderManagementService.getById(id);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.orderManagementService.getById(id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateOrderStatusDTO,
  ) {
    return this.orderManagementService.updateStatus(user.id, id, input);
  }

  @Patch(':id/courier')
  assignCourier(@Param('id') id: string, @Body() input: AssignCourierDTO) {
    return this.orderManagementService.assignCourier(id, input);
  }

  @Patch(':id/assign')
  assignStaff(@Param('id') id: string, @Body() input: AssignStaffDTO) {
    return this.orderManagementService.assignStaff(id, input.staffId);
  }

  @Post(':id/payments')
  collectPayment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: AdminPaymentDTO,
  ) {
    return this.orderManagementService.collectPayment(user.id, id, input);
  }
}

@Controller('admin/order-issues')
@Roles(...STAFF_ROLES)
export class AdminOrderIssuesController {
  constructor(
    private readonly orderManagementService: OrderManagementService,
  ) {}

  @Get()
  findAll(@Query() query: AdminOrderIssuesQueryDTO) {
    return this.orderManagementService.getOrderIssues(query);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateOrderIssueDTO) {
    return this.orderManagementService.updateOrderIssue(id, input);
  }
}
