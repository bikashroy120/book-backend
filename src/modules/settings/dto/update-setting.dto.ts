import { IsDefined } from 'class-validator';

export class UpdateSettingDTO {
  @IsDefined()
  value!: unknown;
}
