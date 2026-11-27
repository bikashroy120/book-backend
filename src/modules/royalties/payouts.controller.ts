import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ADMIN_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AdminPayoutsQueryDTO } from './dto/admin-payouts-query.dto';
import { MyPayoutsQueryDTO } from './dto/my-payouts-query.dto';
import { RequestPayoutDTO } from './dto/request-payout.dto';
import { UpdatePayoutDTO } from './dto/update-payout.dto';
import { RoyaltyService } from './royalty.service';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly royaltyService: RoyaltyService) {}

  @Roles(UserRole.AUTHOR)
  @Post()
  request(@CurrentUser() user: AuthUser, @Body() input: RequestPayoutDTO) {
    return this.royaltyService.requestPayout(user.id, input);
  }

  @Roles(UserRole.AUTHOR)
  @Get('me')
  findMine(@CurrentUser() user: AuthUser, @Query() query: MyPayoutsQueryDTO) {
    return this.royaltyService.getMyPayouts(user.id, query);
  }

  @Roles(UserRole.AUTHOR)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.royaltyService.cancelPayout(user.id, id);
  }

  @Roles(...ADMIN_ROLES)
  @Get()
  findAll(@Query() query: AdminPayoutsQueryDTO) {
    return this.royaltyService.getPayouts(query);
  }

  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdatePayoutDTO,
  ) {
    return this.royaltyService.updatePayout(user.id, id, input);
  }
}
