import { ApprovalStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class AuthorApplicationsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;
}
