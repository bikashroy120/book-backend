import { ManuscriptStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class ManuscriptsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(ManuscriptStatus)
  status?: ManuscriptStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  genre?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  editorId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
