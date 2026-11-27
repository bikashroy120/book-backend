import { UserStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const webUrlOptions = { protocols: ['http', 'https'], require_protocol: true };

export class UpdatePublisherDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nameBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  @IsOptional()
  @IsUrl(webUrlOptions)
  @MaxLength(2048)
  website?: string | null;

  @IsOptional()
  @IsUrl(webUrlOptions)
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
