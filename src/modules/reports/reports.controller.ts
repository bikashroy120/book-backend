import { Controller, Get, Query } from '@nestjs/common';
import { ADMIN_ROLES } from '../../common/constants/roles';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportRangeQueryDTO } from './dto/report-range-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@Roles(...ADMIN_ROLES)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales.csv')
  salesCsv(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.salesCsv(query);
  }

  @Get('sales')
  sales(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.sales(query);
  }

  @Get('top-books.csv')
  topBooksCsv(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.topBooksCsv(query);
  }

  @Get('top-books')
  topBooks(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.topBooks(query);
  }

  @Get('stock-valuation.csv')
  stockValuationCsv() {
    return this.reportsService.stockValuationCsv();
  }

  @Get('stock-valuation')
  stockValuation() {
    return this.reportsService.stockValuation();
  }

  @Get('author-royalties.csv')
  authorRoyaltiesCsv(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.authorRoyaltiesCsv(query);
  }

  @Get('author-royalties')
  authorRoyalties(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.authorRoyalties(query);
  }

  @Get('costs.csv')
  costsCsv(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.costsCsv(query);
  }

  @Get('costs')
  costs(@Query() query: ReportRangeQueryDTO) {
    return this.reportsService.costs(query);
  }
}
