import { StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class StockHistoryQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsString()
  @MinLength(1)
  bookId?: string;

  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @IsString()
  @MinLength(1)
  createdBy?: string;
}
