import { UserRole } from '@prisma/client';

/** Authenticated user attached to the request by AuthGuard (no Passport). */
export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};

/** JWT access-token payload we sign / verify. */
export type JwtPayload = {
  sub: string;
  email: string;
  role: UserRole;
};
