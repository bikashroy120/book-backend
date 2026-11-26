import { IsHexadecimal, IsString, Length } from 'class-validator';

export class VerifyEmailDTO {
  @IsString()
  @Length(64, 64)
  @IsHexadecimal()
  token!: string;
}
