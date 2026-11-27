import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const onlinePaymentMethods = [
  PaymentMethod.COD,
  PaymentMethod.BKASH,
  PaymentMethod.NAGAD,
] as const;

export class CreateOrderItemDTO {
  @IsString()
  @MinLength(1)
  bookId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number;
}

export class CreateOrderDTO {
  @IsIn(onlinePaymentMethods)
  paymentMethod!: (typeof onlinePaymentMethods)[number];

  @IsString()
  @MinLength(1)
  addressId!: string;

  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDTO)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  items!: CreateOrderItemDTO[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
