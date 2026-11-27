import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AssignCourierDTO {
  @IsString()
  @MinLength(1)
  courierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNo?: string | null;
}

export class AssignStaffDTO {
  @IsString()
  @MinLength(1)
  staffId!: string;
}
