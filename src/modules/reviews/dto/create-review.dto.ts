import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDTO {
  @IsString()
  @MinLength(1)
  bookId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  comment!: string;
}
