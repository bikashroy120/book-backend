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
import { AuthorApplicationsQueryDTO } from './dto/author-applications-query.dto';
import { CreateAuthorApplicationDTO } from './dto/create-author-application.dto';
import { ReviewAuthorApplicationDTO } from './dto/review-author-application.dto';
import { AuthorsService } from './authors.service';

@Controller('author-applications')
export class AuthorApplicationsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Roles(UserRole.USER)
  @Post()
  apply(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateAuthorApplicationDTO,
  ) {
    return this.authorsService.createApplication(user.id, input);
  }

  @Roles(UserRole.USER)
  @Get('me')
  getMyApplication(@CurrentUser() user: AuthUser) {
    return this.authorsService.getLatestApplication(user.id);
  }

  @Roles(...ADMIN_ROLES)
  @Get()
  findApplications(@Query() query: AuthorApplicationsQueryDTO) {
    return this.authorsService.findApplications(query);
  }

  @Roles(...ADMIN_ROLES)
  @Patch(':id/review')
  reviewApplication(
    @CurrentUser() reviewer: AuthUser,
    @Param('id') id: string,
    @Body() input: ReviewAuthorApplicationDTO,
  ) {
    return this.authorsService.reviewApplication(reviewer, id, input);
  }
}
