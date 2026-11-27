import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCategoryDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nameBn!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  nameEn!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  parentId?: string | null;
}
