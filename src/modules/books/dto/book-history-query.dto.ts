import { IsOptional, IsString, MinLength } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class BookHistoryQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  @MinLength(1)
  bookId?: string;
}
