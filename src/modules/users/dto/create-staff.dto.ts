import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateStaffDTO {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

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

  @IsIn([UserRole.WORKER, UserRole.MODERATOR, UserRole.ADMIN])
  role!: UserRole;
}
