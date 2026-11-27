import { MagazineStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const reviewStatuses = [MagazineStatus.PUBLISHED, MagazineStatus.REJECTED];

export class ReviewMagazineDTO {
  @IsIn(reviewStatuses)
  status!: (typeof reviewStatuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
