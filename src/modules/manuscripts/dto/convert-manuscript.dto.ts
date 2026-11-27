import { IsOptional, IsString, MinLength } from 'class-validator';

export class ConvertManuscriptDTO {
  @IsString()
  @MinLength(1)
  publisherId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  categoryId?: string;
}
