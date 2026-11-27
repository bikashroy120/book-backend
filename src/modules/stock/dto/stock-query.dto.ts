import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class StockQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string;

  @IsOptional()
  @IsIn(['all', 'in_stock', 'low_stock', 'out_of_stock'])
  tab: 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' = 'all';
}
