import { Module } from '@nestjs/common';
import { BookSchedulerService } from './book-scheduler.service';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { StoreBooksController } from './store-books.controller';

@Module({
  controllers: [BooksController, StoreBooksController],
  providers: [BooksService, BookSchedulerService],
  exports: [BookSchedulerService, BooksService],
})
export class BooksModule {}
