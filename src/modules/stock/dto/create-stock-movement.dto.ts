import { StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const endpointMovementTypes = [
  StockMovementType.PURCHASE,
  StockMovementType.RETURN,
  StockMovementType.ADJUSTMENT,
  StockMovementType.DAMAGE,
] as const;

export class CreateStockMovementDTO {
  @IsIn(endpointMovementTypes)
  type!: (typeof endpointMovementTypes)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ValidateIf(
    (input: CreateStockMovementDTO) =>
      input.type === StockMovementType.ADJUSTMENT,
  )
  @IsIn(['in', 'out'])
  direction?: 'in' | 'out';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
