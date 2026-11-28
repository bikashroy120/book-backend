import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, Matches } from 'class-validator';

export class DashboardQueryDTO {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date?: Date;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'month must use YYYY-MM format',
  })
  month?: string;
}
