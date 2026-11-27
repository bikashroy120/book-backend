import { ApprovalStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewAuthorApplicationDTO {
  @IsIn([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED])
  status!: ApprovalStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
}
