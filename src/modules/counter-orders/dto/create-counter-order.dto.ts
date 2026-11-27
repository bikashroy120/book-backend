import { PaymentMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { numberInput } from '../../books/dto/number-input.transform';

const counterPaymentMethods = [
  PaymentMethod.CASH,
  PaymentMethod.BKASH,
  PaymentMethod.NAGAD,
  PaymentMethod.BANK,
] as const;

export class CounterOrderItemDTO {
  @IsString()
  @MinLength(1)
  bookId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateCounterOrderDTO {
  @IsString()
  @MinLength(1)
  shopId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  repName?: string | null;

  @ValidateNested({ each: true })
  @Type(() => CounterOrderItemDTO)
  @ArrayMinSize(1)
  items!: CounterOrderItemDTO[];

  @IsOptional()
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number | null;

  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  paidAmount!: number;

  @IsIn(counterPaymentMethods)
  paymentMethod!: (typeof counterPaymentMethods)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
