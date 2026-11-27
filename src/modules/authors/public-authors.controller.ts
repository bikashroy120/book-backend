import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AuthorsService } from './authors.service';

@Public()
@Controller('public/authors')
export class PublicAuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get(':id')
  getPublicAuthor(@Param('id') id: string) {
    return this.authorsService.getPublicAuthorById(id);
  }
}
