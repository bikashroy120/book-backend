import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class AuthorReviewsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  bookId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
