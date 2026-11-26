import { Transform } from 'class-transformer';
import {
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  Matches,
  ValidateIf,
} from 'class-validator';

export class UpdateMeDTO {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/^01[3-9]\d{8}$/, {
    message: 'Phone must be a valid Bangladesh mobile number',
  })
  phone?: string | null;

  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2048)
  @Matches(/^(?:https?:\/\/[^\s]+|\/uploads\/[A-Za-z0-9._%/-]+)$/)
  avatarUrl?: string | null;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['bn', 'en'])
  language?: string;
}
