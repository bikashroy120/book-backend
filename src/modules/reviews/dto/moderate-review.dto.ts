import { ReviewStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const moderationStatuses = [
  ReviewStatus.APPROVED,
  ReviewStatus.REJECTED,
  ReviewStatus.CLOSED,
] as const;

export class ModerateReviewDTO {
  @IsIn(moderationStatuses)
  status!: (typeof moderationStatuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
