import { IsOptional, IsString, Matches } from 'class-validator';

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CostMonthQueryDTO {
  @IsOptional()
  @IsString()
  @Matches(monthPattern, { message: 'month must use YYYY-MM format' })
  month?: string;
}
