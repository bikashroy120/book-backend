import { UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

function booleanFromQuery({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

export class ShopsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  @MinLength(1)
  shopType?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @Transform(booleanFromQuery)
  @IsBoolean()
  dueOnly?: boolean;
}
