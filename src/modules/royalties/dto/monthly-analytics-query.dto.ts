import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class MonthlyAnalyticsQueryDTO {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(9999)
  year!: number;
}
