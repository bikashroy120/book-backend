import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { DashboardQueryDTO } from './dto/dashboard-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.WORKER,
  UserRole.AUTHOR,
  UserRole.USER,
)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @CurrentUser() user: AuthUser,
    @Query() query: DashboardQueryDTO,
  ) {
    return this.dashboardService.getDashboard(user, query);
  }
}
