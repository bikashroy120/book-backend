import { ApprovalStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

export class ChangeAuthorStatusDTO {
  @IsIn([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED])
  status!: ApprovalStatus;
}
