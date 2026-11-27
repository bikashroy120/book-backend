import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { STAFF_ROLES } from '../../common/constants/roles';
import type { AuthUser } from '../../common/types/auth-user';
import { CreateStockMovementDTO } from './dto/create-stock-movement.dto';
import { StockHistoryQueryDTO } from './dto/stock-history-query.dto';
import { StockQueryDTO } from './dto/stock-query.dto';
import { UpdateAlertLimitDTO } from './dto/update-alert-limit.dto';
import { StockService } from './stock.service';

@Controller('stock')
@Roles(...STAFF_ROLES)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  findAll(@Query() query: StockQueryDTO) {
    return this.stockService.findAll(query);
  }

  @Get('summary')
  getSummary() {
    return this.stockService.getSummary();
  }

  @Post(':bookId/movements')
  createMovement(
    @Param('bookId') bookId: string,
    @CurrentUser() user: AuthUser,
    @Body() input: CreateStockMovementDTO,
  ) {
    return this.stockService.createMovement(bookId, user.id, input);
  }

  @Get('history')
  getHistory(@Query() query: StockHistoryQueryDTO) {
    return this.stockService.getHistory(query);
  }

  @Patch(':bookId/alert-limit')
  updateAlertLimit(
    @Param('bookId') bookId: string,
    @Body() input: UpdateAlertLimitDTO,
  ) {
    return this.stockService.updateAlertLimit(bookId, input);
  }

  @Get('alerts')
  getAlerts() {
    return this.stockService.getAlerts();
  }

  @Get('export.csv')
  exportCsv() {
    return this.stockService.exportCsv();
  }
}
