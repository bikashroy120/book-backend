import { IsOptional, IsString, MinLength } from 'class-validator';
import { CostMonthQueryDTO } from './cost-month-query.dto';

export class CostBooksQueryDTO extends CostMonthQueryDTO {
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;
}
