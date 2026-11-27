import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { STAFF_ROLES } from '../../common/constants/roles';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateCourierDTO, UpdateCourierDTO } from './dto/courier.dto';
import { CouriersService } from './couriers.service';

@Controller('couriers')
@Roles(...STAFF_ROLES)
export class CouriersController {
  constructor(private readonly couriersService: CouriersService) {}

  @Get()
  findAll() {
    return this.couriersService.findAll();
  }

  @Post()
  create(@Body() input: CreateCourierDTO) {
    return this.couriersService.create(input);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateCourierDTO) {
    return this.couriersService.update(id, input);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.couriersService.deactivate(id);
  }
}
