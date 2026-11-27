import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMagazineDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  summary!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverUrl?: string;
}
