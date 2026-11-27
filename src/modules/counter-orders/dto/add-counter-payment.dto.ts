import { PaymentMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { numberInput } from '../../books/dto/number-input.transform';

const counterPaymentMethods = [
  PaymentMethod.CASH,
  PaymentMethod.BKASH,
  PaymentMethod.NAGAD,
  PaymentMethod.BANK,
] as const;

export class AddCounterPaymentDTO {
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsIn(counterPaymentMethods)
  method!: (typeof counterPaymentMethods)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  transactionId?: string | null;
}
