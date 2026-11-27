import { CostCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class CostsQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(CostCategory)
  category?: CostCategory;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must use YYYY-MM format',
  })
  month?: string;
}
