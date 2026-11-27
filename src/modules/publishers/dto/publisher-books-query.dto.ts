import { BookStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class PublisherBooksQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(BookStatus)
  status?: BookStatus;
}
