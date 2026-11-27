import { UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { numberInput } from '../../books/dto/number-input.transform';

export class CreateShopDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  shopType?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  ownerName!: string;

  @IsString()
  @Matches(/^01[3-9]\d{8}$/)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsapp?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  area?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate!: number;
}

export class UpdateShopDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  shopType?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  ownerName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^01[3-9]\d{8}$/)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsapp?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  area?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(UserStatus)
  status?: UserStatus;
}
