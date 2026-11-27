import { PaymentMethod } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { numberInput } from '../../books/dto/number-input.transform';

const payoutMethods = [
  PaymentMethod.BKASH,
  PaymentMethod.NAGAD,
  PaymentMethod.BANK,
] as const;

export class RequestPayoutDTO {
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsIn(payoutMethods)
  method!: (typeof payoutMethods)[number];

  @IsString()
  @MinLength(5)
  @MaxLength(100)
  accountNo!: string;
}
