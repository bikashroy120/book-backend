import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAuthorApplicationDTO {
  @IsString()
  @MinLength(20)
  @MaxLength(10000)
  introduction!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(10000)
  writingSample!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(10000)
  motivation!: string;
}
