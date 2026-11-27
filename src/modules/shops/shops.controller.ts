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
import { CreateShopDTO, UpdateShopDTO } from './dto/create-shop.dto';
import { ShopsQueryDTO } from './dto/shops-query.dto';
import { ShopsService } from './shops.service';

@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Roles(...STAFF_ROLES)
  @Get()
  findAll(@Query() query: ShopsQueryDTO) {
    return this.shopsService.findAll(query);
  }

  @Roles(...STAFF_ROLES)
  @Get('summary')
  getSummary() {
    return this.shopsService.getSummary();
  }

  @Roles(...STAFF_ROLES)
  @Get('options')
  getOptions() {
    return this.shopsService.getOptions();
  }

  @Roles(...STAFF_ROLES)
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.shopsService.getById(id);
  }

  @Roles(...STAFF_ROLES)
  @Post()
  create(@Body() input: CreateShopDTO) {
    return this.shopsService.create(input);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateShopDTO) {
    return this.shopsService.update(id, input);
  }

  @Roles(...ADMIN_ROLES)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.shopsService.delete(id);
  }
}
