import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ADMIN_ROLES } from '../../common/constants/roles';
import type { AuthUser } from '../../common/types/auth-user';
import { ChangePasswordDTO } from './dto/change-password.dto';
import { ChangeUserRoleDTO } from './dto/change-user-role.dto';
import { ChangeUserStatusDTO } from './dto/change-user-status.dto';
import { CreateStaffDTO } from './dto/create-staff.dto';
import { UpdateMeDTO } from './dto/update-me.dto';
import { UsersQueryDTO } from './dto/users-query.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() input: UpdateMeDTO) {
    return this.usersService.updateMe(user.id, input);
  }

  @Post('me/change-password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() input: ChangePasswordDTO,
  ) {
    return this.usersService.changePassword(user.id, input);
  }

  @Delete('me/avatar')
  deleteAvatar(@CurrentUser() user: AuthUser) {
    return this.usersService.deleteAvatar(user.id);
  }

  @Roles(...ADMIN_ROLES)
  @Get()
  findAll(@Query() query: UsersQueryDTO) {
    return this.usersService.findAll(query);
  }

  @Roles(...ADMIN_ROLES)
  @Get('summary')
  getSummary() {
    return this.usersService.getSummary();
  }

  @Roles(...ADMIN_ROLES)
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.usersService.getAdminUser(id);
  }

  @Roles(...ADMIN_ROLES)
  @Post()
  createStaff(@CurrentUser() actor: AuthUser, @Body() input: CreateStaffDTO) {
    return this.usersService.createStaff(actor, input);
  }

  @Roles(...ADMIN_ROLES)
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() input: ChangeUserStatusDTO,
  ) {
    return this.usersService.changeStatus(actor, id, input);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/role')
  changeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() input: ChangeUserRoleDTO,
  ) {
    return this.usersService.changeRole(actor, id, input);
  }
}
