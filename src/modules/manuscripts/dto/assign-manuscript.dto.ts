import { IsString, MinLength } from 'class-validator';

export class AssignManuscriptDTO {
  @IsString()
  @MinLength(1)
  editorId!: string;
}
