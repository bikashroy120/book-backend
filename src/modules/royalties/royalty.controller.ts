import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { MonthlyAnalyticsQueryDTO } from './dto/monthly-analytics-query.dto';
import { RoyaltyService } from './royalty.service';

@Controller('author/analytics')
@Roles(UserRole.AUTHOR)
export class AuthorAnalyticsController {
  constructor(private readonly royaltyService: RoyaltyService) {}

  @Get()
  getAnalytics(@CurrentUser() user: AuthUser) {
    return this.royaltyService.getAnalytics(user.id);
  }

  @Get('monthly')
  getMonthly(
    @CurrentUser() user: AuthUser,
    @Query() query: MonthlyAnalyticsQueryDTO,
  ) {
    return this.royaltyService.getMonthlyAnalytics(user.id, query);
  }

  @Get('books')
  getBooks(@CurrentUser() user: AuthUser) {
    return this.royaltyService.getAuthorBookAnalytics(user.id);
  }
}
