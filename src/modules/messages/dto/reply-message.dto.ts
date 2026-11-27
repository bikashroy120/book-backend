import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyMessageDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  reply!: string;
}
