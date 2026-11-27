import {
  DeliveryStatus,
  OrderChannel,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class AdminOrdersQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(OrderChannel)
  channel?: OrderChannel;

  @IsOptional()
  @IsEnum(OrderStatus)
  orderStatus?: OrderStatus;

  @IsOptional()
  @IsEnum(DeliveryStatus)
  deliveryStatus?: DeliveryStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  courierId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  district?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  staffId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsIn(['placedAt', 'total'])
  sort: 'placedAt' | 'total' = 'placedAt';
}
