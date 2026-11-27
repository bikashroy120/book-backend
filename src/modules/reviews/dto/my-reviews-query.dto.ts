import { IsIn, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

const myReviewTabs = [
  'all',
  'pending',
  'published',
  'rejected',
  'hidden',
] as const;

export class MyReviewsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsIn(myReviewTabs)
  tab?: (typeof myReviewTabs)[number] = 'all';
}
