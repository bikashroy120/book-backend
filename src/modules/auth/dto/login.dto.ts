import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDTO {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(254)
  @Matches(/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|01[3-9]\d{8})$/, {
    message:
      'Identifier must be a valid email address or Bangladesh mobile number',
  })
  identifier!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
