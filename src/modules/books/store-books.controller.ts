import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { StoreBooksQueryDTO } from './dto/store-books-query.dto';
import { BooksService } from './books.service';

@Public()
@Controller('store/books')
export class StoreBooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  findStoreBooks(@Query() query: StoreBooksQueryDTO) {
    return this.booksService.findStoreBooks(query);
  }

  @Get(':slug')
  getStoreBook(@Param('slug') slug: string) {
    return this.booksService.getStoreBook(slug);
  }
}
