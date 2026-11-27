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
import { AssignManuscriptDTO } from './dto/assign-manuscript.dto';
import { ConvertManuscriptDTO } from './dto/convert-manuscript.dto';
import { CreateManuscriptDTO } from './dto/create-manuscript.dto';
import { ManuscriptFeedbackDTO } from './dto/manuscript-feedback.dto';
import { ManuscriptsQueryDTO } from './dto/manuscripts-query.dto';
import { MyManuscriptsQueryDTO } from './dto/my-manuscripts-query.dto';
import { ResubmitManuscriptDTO } from './dto/resubmit-manuscript.dto';
import { UpdateManuscriptStatusDTO } from './dto/update-manuscript-status.dto';
import { ManuscriptsService } from './manuscripts.service';

@Controller('manuscripts')
export class ManuscriptsController {
  constructor(private readonly manuscriptsService: ManuscriptsService) {}

  @Roles(UserRole.AUTHOR)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: CreateManuscriptDTO) {
    return this.manuscriptsService.create(user.id, input);
  }

  @Roles(UserRole.AUTHOR)
  @Get('me')
  findMine(
    @CurrentUser() user: AuthUser,
    @Query() query: MyManuscriptsQueryDTO,
  ) {
    return this.manuscriptsService.findMine(user.id, query);
  }

  @Roles(UserRole.AUTHOR)
  @Get('me/:id')
  getMine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.manuscriptsService.getMine(user.id, id);
  }

  @Roles(UserRole.AUTHOR)
  @Post('me/:id/feedback')
  addAuthorFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ManuscriptFeedbackDTO,
  ) {
    return this.manuscriptsService.addAuthorFeedback(user.id, id, input);
  }

  @Roles(UserRole.AUTHOR)
  @Patch('me/:id/resubmit')
  resubmit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ResubmitManuscriptDTO,
  ) {
    return this.manuscriptsService.resubmit(user.id, id, input);
  }

  @Roles(...STAFF_ROLES)
  @Get()
  findAll(@Query() query: ManuscriptsQueryDTO) {
    return this.manuscriptsService.findAll(query);
  }

  @Roles(...STAFF_ROLES)
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.manuscriptsService.getById(id);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id/assign')
  assignEditor(@Param('id') id: string, @Body() input: AssignManuscriptDTO) {
    return this.manuscriptsService.assignEditor(id, input);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() input: UpdateManuscriptStatusDTO,
  ) {
    return this.manuscriptsService.updateStatus(id, input);
  }

  @Roles(...STAFF_ROLES)
  @Post(':id/feedback')
  addStaffFeedback(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ManuscriptFeedbackDTO,
  ) {
    return this.manuscriptsService.addStaffFeedback(user.id, id, input);
  }

  @Roles(...ADMIN_ROLES)
  @Post(':id/convert-to-book')
  convertToBook(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ConvertManuscriptDTO,
  ) {
    return this.manuscriptsService.convertToBook(user.id, id, input);
  }
}
