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
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateCategoryDTO } from './dto/create-category.dto';
import { UpdateCategoryDTO } from './dto/update-category.dto';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  findTree() {
    return this.categoriesService.findTree();
  }

  @Roles(...STAFF_ROLES)
  @Post()
  create(@Body() input: CreateCategoryDTO) {
    return this.categoriesService.create(input);
  }

  @Roles(...STAFF_ROLES)
  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateCategoryDTO) {
    return this.categoriesService.update(id, input);
  }

  @Roles(...STAFF_ROLES)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.categoriesService.delete(id);
  }
}
