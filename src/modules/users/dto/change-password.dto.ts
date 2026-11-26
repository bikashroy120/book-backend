import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDTO {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one number',
  })
  newPassword!: string;
}
