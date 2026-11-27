import { ManuscriptSubmitType } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ResubmitManuscriptDTO {
  @IsOptional()
  @IsEnum(ManuscriptSubmitType)
  submitType?: ManuscriptSubmitType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  fileUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(500)
  textContent?: string;
}
