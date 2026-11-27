import { Module } from '@nestjs/common';
import { BooksModule } from '../books/books.module';
import { ManuscriptsController } from './manuscripts.controller';
import { ManuscriptsService } from './manuscripts.service';

@Module({
  imports: [BooksModule],
  controllers: [ManuscriptsController],
  providers: [ManuscriptsService],
})
export class ManuscriptsModule {}
