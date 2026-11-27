import { IsIn } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class OrdersQueryDTO extends PaginationDTO {
  @IsIn(['all', 'new', 'processing', 'in_transit', 'delivered', 'cancelled'])
  tab: 'all' | 'new' | 'processing' | 'in_transit' | 'delivered' | 'cancelled' =
    'all';
}
