import { IsIn, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

const payoutTabs = [
  'all',
  'pending',
  'approved',
  'paid',
  'rejected',
  'cancelled',
] as const;

export class MyPayoutsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsIn(payoutTabs)
  tab?: (typeof payoutTabs)[number] = 'all';
}
