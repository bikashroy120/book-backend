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
import { STAFF_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { BookHistoryQueryDTO } from './dto/book-history-query.dto';
import { BooksQueryDTO } from './dto/books-query.dto';
import { ChangeBookStatusDTO } from './dto/change-book-status.dto';
import { CreateBookDTO } from './dto/create-book.dto';
import { UpdateBookDTO } from './dto/update-book.dto';
import { BooksService } from './books.service';

@Controller('books')
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Roles(...STAFF_ROLES)
  @Post()
  create(@CurrentUser() editor: AuthUser, @Body() input: CreateBookDTO) {
    return this.booksService.create(editor, input);
  }

  @Roles(...STAFF_ROLES)
  @Get()
  findAll(@Query() query: BooksQueryDTO) {
    return this.booksService.findAll(query);
  }

  @Roles(...STAFF_ROLES)
  @Get('history')
  getHistory(@Query() query: BookHistoryQueryDTO) {
    return this.booksService.getHistory(query);
  }

  @Roles(UserRole.AUTHOR)
  @Get('mine')
  getMine(@CurrentUser() user: AuthUser, @Query() query: BooksQueryDTO) {
    return this.booksService.getAuthorBooks(user.id, query);
  }

  @Roles(...STAFF_ROLES)
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.booksService.getById(id);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id')
  update(
    @CurrentUser() editor: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateBookDTO,
  ) {
    return this.booksService.update(editor, id, input);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() editor: AuthUser,
    @Param('id') id: string,
    @Body() input: ChangeBookStatusDTO,
  ) {
    return this.booksService.changeStatus(editor, id, input);
  }

  @Roles(...STAFF_ROLES)
  @Delete(':id')
  delete(@CurrentUser() editor: AuthUser, @Param('id') id: string) {
    return this.booksService.archive(editor, id);
  }
}
