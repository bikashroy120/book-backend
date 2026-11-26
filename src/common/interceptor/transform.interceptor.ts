import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  meta?: unknown;
}

function isDataResponse<T>(
  value: unknown,
): value is { data: T; message?: unknown; meta?: unknown } {
  return typeof value === 'object' && value !== null && 'data' in value;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  Response<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<Response<T>> {
    return next.handle().pipe(
      map((res: unknown): Response<T> => {
        const statusCode = context
          .switchToHttp()
          .getResponse<{ statusCode: number }>().statusCode;
        if (isDataResponse<T>(res)) {
          return {
            success: true,
            statusCode,
            message: typeof res.message === 'string' ? res.message : 'Success',
            data: res.data,
            ...(res.meta !== undefined ? { meta: res.meta } : {}),
          };
        }
        return {
          success: true,
          statusCode,
          message: 'Success',
          data: res as T,
        };
      }),
    );
  }
}
