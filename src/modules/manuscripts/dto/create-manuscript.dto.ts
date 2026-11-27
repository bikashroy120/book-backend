import { ManuscriptSubmitType } from '@prisma/client';
import {
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateManuscriptDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  genre!: string;

  @IsEnum(ManuscriptSubmitType)
  submitType!: ManuscriptSubmitType;

  @ValidateIf(
    (input: CreateManuscriptDTO, value: unknown) =>
      input.submitType === ManuscriptSubmitType.FILE || value !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  fileUrl?: string;

  @ValidateIf(
    (input: CreateManuscriptDTO, value: unknown) =>
      input.submitType === ManuscriptSubmitType.TEXT || value !== undefined,
  )
  @IsString()
  @MinLength(500)
  textContent?: string;
}
