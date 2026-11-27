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
} from 'class-validator';
import { numberInput } from '../../books/dto/number-input.transform';

export class CreateBookCostDTO {
  @IsString()
  @MinLength(1)
  bookId!: string;

  @IsEnum(ProductionCostType)
  productionType!: ProductionCostType;

  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @Type(() => Date)
  @IsDate()
  date!: Date;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
