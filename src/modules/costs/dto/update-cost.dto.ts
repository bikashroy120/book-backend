import { ProductionCostType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { numberInput } from '../../books/dto/number-input.transform';

export class UpdateCostDTO {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Date)
  @IsDate()
  date?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(ProductionCostType)
  productionType?: ProductionCostType;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  bookId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  employeeId?: string;
}
