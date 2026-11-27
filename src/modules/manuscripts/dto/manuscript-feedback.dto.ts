import { IsString, MaxLength, MinLength } from 'class-validator';

export class ManuscriptFeedbackDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}
