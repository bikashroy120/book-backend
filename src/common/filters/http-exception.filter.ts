import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response, Request } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseMessage = (exceptionResponse as { message?: unknown })
          .message;
        if (
          typeof responseMessage === 'string' ||
          Array.isArray(responseMessage)
        ) {
          message = responseMessage as string | string[];
        } else {
          message = exception.message;
        }
      } else {
        message = String(exceptionResponse);
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2000':
        case 'P2003':
        case 'P2014':
          status = HttpStatus.BAD_REQUEST;
          message = 'The provided data is invalid';
          break;
        case 'P2001':
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'The requested record was not found';
          break;
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'A record with this value already exists';
          break;
        case 'P2034':
          status = HttpStatus.CONFLICT;
          message = 'The operation conflicted with another update';
          break;
        case 'P2024':
          status = HttpStatus.SERVICE_UNAVAILABLE;
          message = 'Database service is temporarily unavailable';
          break;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'The provided data is invalid';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database service is temporarily unavailable';
    }

    const logEntry: Record<string, unknown> = {
      method: request.method,
      path: request.path,
      statusCode: status,
      error: exception instanceof Error ? exception.name : typeof exception,
      message:
        exception instanceof Error ? exception.message : String(exception),
    };

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      logEntry.prismaCode = exception.code;
      logEntry.prismaMeta = exception.meta;
    } else if (exception instanceof HttpException) {
      logEntry.details = exception.getResponse();
    }

    const stack = exception instanceof Error ? exception.stack : undefined;
    const serializedLog = JSON.stringify(logEntry);
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(serializedLog, stack);
    } else {
      this.logger.warn(serializedLog);
    }

    if (
      status >= HttpStatus.INTERNAL_SERVER_ERROR &&
      process.env.NODE_ENV === 'production'
    ) {
      message = 'Internal server error';
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.path,
      message,
    });
  }
}
