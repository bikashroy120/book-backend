import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { STAFF_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { CreateMagazineDTO } from './dto/create-magazine.dto';
import { MagazinesQueryDTO } from './dto/magazines-query.dto';
import { ReviewMagazineDTO } from './dto/review-magazine.dto';
import { UpdateMagazineDTO } from './dto/update-magazine.dto';
import { MagazinesService } from './magazines.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@Controller('magazines')
export class MagazinesController {
  constructor(private readonly magazinesService: MagazinesService) {}

  @Public()
  @UseGuards(OptionalAuthGuard)
  @Get()
  findAll(
    @CurrentUser() user: AuthUser | undefined,
    @Query() query: MagazinesQueryDTO,
  ) {
    return this.magazinesService.findAll(query, user);
  }

  @Roles(UserRole.USER)
  @Get('me')
  findMine(@CurrentUser() user: AuthUser) {
    return this.magazinesService.findMine(user.id);
  }

  @Public()
  @Get(':id')
  findPublishedById(@Param('id') id: string) {
    return this.magazinesService.findPublishedById(id);
  }

  @Roles(UserRole.USER)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: CreateMagazineDTO) {
    return this.magazinesService.create(user.id, input);
  }

  @Roles(UserRole.USER)
  @Patch(':id')
  updateOwn(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateMagazineDTO,
  ) {
    return this.magazinesService.updateOwn(user.id, id, input);
  }

  @Roles(UserRole.USER)
  @Delete(':id')
  removeOwn(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.magazinesService.removeOwn(user.id, id);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id/review')
  review(@Param('id') id: string, @Body() input: ReviewMagazineDTO) {
    return this.magazinesService.review(id, input);
  }
}
