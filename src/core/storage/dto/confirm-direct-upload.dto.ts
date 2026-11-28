import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmDirectUploadDTO {
  @IsString()
  @MinLength(10)
  @MaxLength(2048)
  ticket!: string;
}
