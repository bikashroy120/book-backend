import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

const moderationTabs = ['pending', 'reported', 'approved', 'closed'] as const;

export class ReviewModerationQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsIn(moderationTabs)
  tab?: (typeof moderationTabs)[number] = 'pending';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
