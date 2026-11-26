import {
  IsHexadecimal,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class ResetPasswordDTO {
  @IsString()
  @Length(64, 64)
  @IsHexadecimal()
  token!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  newPassword!: string;
}
