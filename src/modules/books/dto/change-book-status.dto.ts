import { BookStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsDate, IsOptional } from 'class-validator';

export class ChangeBookStatusDTO {
  @IsEnum(BookStatus)
  status!: BookStatus;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;
}
