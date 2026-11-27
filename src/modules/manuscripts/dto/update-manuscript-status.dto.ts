import { ManuscriptStatus, Priority } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class UpdateManuscriptStatusDTO {
  @IsEnum(ManuscriptStatus)
  status!: ManuscriptStatus;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;
}
