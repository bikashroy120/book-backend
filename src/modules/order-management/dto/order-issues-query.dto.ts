import { IssueStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class AdminOrderIssuesQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;
}
