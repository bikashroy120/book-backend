import { UserRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangeUserRoleDTO {
  @IsEnum(UserRole)
  role!: UserRole;
}
