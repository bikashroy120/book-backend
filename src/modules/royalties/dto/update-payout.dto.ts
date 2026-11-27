import { PayoutStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const reviewablePayoutStatuses = [
  PayoutStatus.APPROVED,
  PayoutStatus.PAID,
  PayoutStatus.REJECTED,
] as const;

export class UpdatePayoutDTO {
  @IsIn(reviewablePayoutStatuses)
  status!: (typeof reviewablePayoutStatuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string | null;
}
