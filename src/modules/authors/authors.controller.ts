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
import { ADMIN_ROLES, STAFF_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AuthorsQueryDTO } from './dto/authors-query.dto';
import { ChangeAuthorStatusDTO } from './dto/change-author-status.dto';
import { UpdateAuthorProfileDTO } from './dto/update-author-profile.dto';
import { AuthorsService } from './authors.service';

@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Roles(UserRole.AUTHOR)
  @Get('me')
  getMe(@CurrentUser() user: AuthUser) {
    return this.authorsService.getAuthorProfile(user.id);
  }

  @Roles(UserRole.AUTHOR)
  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() input: UpdateAuthorProfileDTO,
  ) {
    return this.authorsService.updateAuthorProfile(user.id, input);
  }

  @Roles(UserRole.AUTHOR)
  @Post('me/agree-terms')
  agreeToTerms(@CurrentUser() user: AuthUser) {
    return this.authorsService.agreeToTerms(user.id);
  }

  @Roles(UserRole.AUTHOR)
  @Get('me/terms-status')
  getTermsStatus(@CurrentUser() user: AuthUser) {
    return this.authorsService.getTermsStatus(user.id);
  }

  @Roles(...STAFF_ROLES)
  @Get()
  findAuthors(@Query() query: AuthorsQueryDTO) {
    return this.authorsService.findAuthors(query);
  }

  @Roles(...STAFF_ROLES)
  @Get('summary')
  getSummary() {
    return this.authorsService.getSummary();
  }

  @Roles(...STAFF_ROLES)
  @Get(':id')
  getAuthor(@Param('id') id: string) {
    return this.authorsService.getAuthorById(id);
  }

  @Roles(...ADMIN_ROLES)
  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() input: ChangeAuthorStatusDTO) {
    return this.authorsService.changeAuthorStatus(id, input.status);
  }
}
