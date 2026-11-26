import { UserRole } from '@prisma/client';

/** @deprecated Prefer AuthUser / JwtPayload from types/auth-user.js */
export interface IJwtPayload {
  id: string;
  role: UserRole;
  email: string;
  phone?: string;
}
