import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AddressesService } from './addresses.service';
import { AddressDTO, CreateAddressDTO } from './dto/address.dto';

@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.addressesService.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: CreateAddressDTO) {
    return this.addressesService.create(user.id, input);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: AddressDTO,
  ) {
    return this.addressesService.update(user.id, id, input);
  }

  @Patch(':id/default')
  setDefault(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.addressesService.setDefault(user.id, id);
  }

  @Delete(':id')
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.addressesService.delete(user.id, id);
  }
}
