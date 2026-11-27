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
import { ADMIN_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { CostBooksQueryDTO } from './dto/cost-books-query.dto';
import { CostMonthQueryDTO } from './dto/cost-month-query.dto';
import { CostsQueryDTO } from './dto/costs-query.dto';
import { CreateBookCostDTO } from './dto/create-book-cost.dto';
import { CreateMarketingCostDTO } from './dto/create-marketing-cost.dto';
import { CreateSalaryCostDTO } from './dto/create-salary-cost.dto';
import { UpdateCostDTO } from './dto/update-cost.dto';
import { CostsService } from './costs.service';

@Controller('costs')
@Roles(...ADMIN_ROLES)
export class CostsController {
  constructor(private readonly costsService: CostsService) {}

  @Get('summary')
  getSummary(@Query() query: CostMonthQueryDTO) {
    return this.costsService.getSummary(query);
  }

  @Get('books')
  getBookCosts(@Query() query: CostBooksQueryDTO) {
    return this.costsService.getBookCosts(query);
  }

  @Get('export.csv')
  exportCsv(@Query() query: CostMonthQueryDTO) {
    return this.costsService.exportCsv(query);
  }

  @Get()
  findAll(@Query() query: CostsQueryDTO) {
    return this.costsService.findAll(query);
  }

  @Post('book')
  createBookCost(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateBookCostDTO,
  ) {
    return this.costsService.createBookCost(user.id, input);
  }

  @Post('salary')
  createSalaryCost(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateSalaryCostDTO,
  ) {
    return this.costsService.createSalaryCost(user.id, input);
  }

  @Post('marketing')
  createMarketingCost(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateMarketingCostDTO,
  ) {
    return this.costsService.createMarketingCost(user.id, input);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() input: UpdateCostDTO) {
    return this.costsService.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.costsService.remove(id);
  }
}
