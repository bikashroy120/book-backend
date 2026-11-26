/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser } from '../types/auth-user';

/** Inject the AuthUser set by AuthGuard (Bearer JWT / cookie). */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUser | undefined;
    return data ? user?.[data] : user;
  },
);
