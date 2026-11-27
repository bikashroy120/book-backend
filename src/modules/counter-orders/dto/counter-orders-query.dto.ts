import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class CounterOrdersQueryDTO extends PaginationDTO {
  @IsIn(['all', 'today', 'paid', 'due'])
  tab: 'all' | 'today' | 'paid' | 'due' = 'all';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
