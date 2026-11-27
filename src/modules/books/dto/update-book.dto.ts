import { CoverType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { numberInput } from './number-input.transform';

export class UpdateBookDTO {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  publisherId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  authorName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  authorId?: string | null;

  @IsOptional()
  @Transform(numberInput)
  @IsInt()
  @Min(1)
  totalPages?: number | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn([CoverType.PAPERBACK, CoverType.HARDCOVER])
  coverType?: CoverType;

  @IsOptional()
  @Transform(numberInput)
  @IsInt()
  @Min(1000)
  @Max(9999)
  publishYear?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  wholesalePrice?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(numberInput)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  royaltyRate?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(numberInput)
  @IsInt()
  @Min(0)
  alertLimit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  coverImageUrl?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(2048, { each: true })
  imageUrls?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  samplePdfUrl?: string | null;

  @Allow()
  salePrice?: unknown;
}
