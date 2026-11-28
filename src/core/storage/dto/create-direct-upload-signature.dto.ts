import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum DirectUploadTypeDTO {
  IMAGE = 'image',
  PDF = 'pdf',
  MANUSCRIPT = 'manuscript',
}

export class CreateDirectUploadSignatureDTO {
  @IsEnum(DirectUploadTypeDTO)
  type!: DirectUploadTypeDTO;

  @IsOptional()
  @IsString()
  format?: string;
}
