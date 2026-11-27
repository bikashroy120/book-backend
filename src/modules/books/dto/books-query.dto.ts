import { BookStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class BooksQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  @MinLength(1)
  publisherId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string;

  @IsOptional()
  @IsEnum(BookStatus)
  status?: BookStatus;
}
