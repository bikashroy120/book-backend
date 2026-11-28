import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptor/transform.interceptor';

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  app.setGlobalPrefix('api/v1');
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );
  const requestLogger: RequestHandler = (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    const startedAt = Date.now();
    response.once('finish', () => {
      Logger.log(
        JSON.stringify({
          method: request.method,
          path: request.path,
          statusCode: response.statusCode,
          durationMs: Date.now() - startedAt,
        }),
        'HTTP',
      );
    });
    next();
  };
  app.use(requestLogger);
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_URL'),
    credentials: true,
  });
  if (!process.env.VERCEL) {
    app.useStaticAssets(resolve(config.getOrThrow<string>('UPLOAD_DIR')), {
      prefix: '/uploads/',
    });
  }
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  if (!isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('Hosonta Prokashon API')
      .setDescription('Book publishing and e-commerce backend API')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        'BearerAuth',
      )
      .addTag('Authentication')
      .addTag('Users')
      .addTag('Addresses')
      .addTag('Authors')
      .addTag('Publishers')
      .addTag('Categories')
      .addTag('Books')
      .addTag('Stock')
      .addTag('Shops')
      .addTag('Orders')
      .addTag('Counter Orders')
      .addTag('Order Management')
      .addTag('Wishlist')
      .addTag('Reviews')
      .addTag('Manuscripts')
      .addTag('Royalties & Payouts')
      .addTag('Costs')
      .addTag('Messages')
      .addTag('Magazines')
      .addTag('Dashboard')
      .addTag('Reports')
      .addTag('Settings')
      .addTag('Uploads')
      .addTag('Health')
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    applySwaggerOperationMetadata(document);
    SwaggerModule.setup('api/docs', app, document, {
      useGlobalPrefix: false,
    });
  }

  await app.init();
  return app;
}

function applySwaggerOperationMetadata(
  document: ReturnType<typeof SwaggerModule.createDocument>,
): void {
  const tagsByPrefix: Record<string, string> = {
    auth: 'Authentication',
    users: 'Users',
    addresses: 'Addresses',
    authors: 'Authors',
    'author-applications': 'Authors',
    'public/authors': 'Authors',
    publishers: 'Publishers',
    categories: 'Categories',
    books: 'Books',
    'store/books': 'Books',
    stock: 'Stock',
    shops: 'Shops',
    orders: 'Orders',
    'counter-orders': 'Counter Orders',
    'admin/orders': 'Order Management',
    'admin/order-issues': 'Order Management',
    couriers: 'Order Management',
    wishlist: 'Wishlist',
    reviews: 'Reviews',
    'store/books/{bookId}/reviews': 'Reviews',
    manuscripts: 'Manuscripts',
    payouts: 'Royalties & Payouts',
    'author/analytics': 'Royalties & Payouts',
    costs: 'Costs',
    contact: 'Messages',
    messages: 'Messages',
    magazines: 'Magazines',
    dashboard: 'Dashboard',
    reports: 'Reports',
    settings: 'Settings',
    uploads: 'Uploads',
    health: 'Health',
  };
  const publicRoutes = [
    { method: 'get', path: /^\/health$/ },
    { method: 'get', path: /^\/categories$/ },
    { method: 'get', path: /^\/public\/authors\/[^/]+$/ },
    { method: 'get', path: /^\/settings\/public$/ },
    { method: 'post', path: /^\/contact$/ },
    { method: 'get', path: /^\/magazines(?:\/[^/]+)?$/ },
  ];
  const methods = [
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace',
  ] as const;

  for (const [path, pathItem] of Object.entries(document.paths)) {
    const normalizedPath = path.replace(/^\/api\/v1/, '');
    const tagPrefix = Object.keys(tagsByPrefix)
      .sort((left, right) => right.length - left.length)
      .find(
        (prefix) =>
          normalizedPath === `/${prefix}` ||
          normalizedPath.startsWith(`/${prefix}/`),
      );
    if (!tagPrefix) continue;

    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;
      operation.tags = [tagsByPrefix[tagPrefix]];
      const isPublic =
        publicRoutes.some(
          (route) => route.method === method && route.path.test(normalizedPath),
        ) ||
        normalizedPath.startsWith('/auth/') ||
        normalizedPath.startsWith('/store/');
      operation.security = isPublic ? [] : [{ BearerAuth: [] }];
    }
  }
}
