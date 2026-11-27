import { ApprovalStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class AuthorsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;
}
