import { Module } from '@nestjs/common';
import { AuthorApplicationsController } from './author-applications.controller';
import { AuthorsController } from './authors.controller';
import { PublicAuthorsController } from './public-authors.controller';
import { AuthorsService } from './authors.service';
import { RoyaltiesModule } from '../royalties/royalties.module';

@Module({
  imports: [RoyaltiesModule],
  controllers: [
    AuthorApplicationsController,
    AuthorsController,
    PublicAuthorsController,
  ],
  providers: [AuthorsService],
  exports: [AuthorsService],
})
export class AuthorsModule {}
