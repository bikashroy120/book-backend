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
import { ADMIN_ROLES, STAFF_ROLES } from '../../common/constants/roles';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreatePublisherDTO } from './dto/create-publisher.dto';
import { PublisherBooksQueryDTO } from './dto/publisher-books-query.dto';
import { PublishersQueryDTO } from './dto/publishers-query.dto';
import { UpdatePublisherDTO } from './dto/update-publisher.dto';
import { PublishersService } from './publishers.service';

@Controller('publishers')
export class PublishersController {
  constructor(private readonly publishersService: PublishersService) {}

  @Roles(...STAFF_ROLES)
  @Get()
  findAll(@Query() query: PublishersQueryDTO) {
    return this.publishersService.findAll(query);
  }

  @Roles(...STAFF_ROLES)
  @Get('summary')
  getSummary() {
    return this.publishersService.getSummary();
  }

  @Roles(...STAFF_ROLES)
  @Get(':id')
  getById(@Param('id') id: string, @Query() query: PublisherBooksQueryDTO) {
    return this.publishersService.getById(id, query);
  }

  @Roles(...ADMIN_ROLES)
  @Post()
  create(@Body() input: CreatePublisherDTO) {
    return this.publishersService.create(input);
  }

  @Roles(...ADMIN_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdatePublisherDTO) {
    return this.publishersService.update(id, input);
  }

  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.publishersService.delete(id);
  }
}
