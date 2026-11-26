import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { TransformInterceptor } from '../src/common/interceptor/transform.interceptor';
import { rm } from 'node:fs/promises';

describe('AppController (e2e)', () => {
  let app: NestExpressApplication<App>;
  let uploadDirectory: string;

  beforeAll(async () => {
    const configuredUploadDirectory = process.env.UPLOAD_DIR;
    if (!configuredUploadDirectory) {
      throw new Error('E2E upload directory is not configured');
    }
    uploadDirectory = configuredUploadDirectory;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useStaticAssets(uploadDirectory, { prefix: '/uploads/' });
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await rm(uploadDirectory, { recursive: true, force: true });
  });

  it('GET /api/v1/health is public', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ text }) => {
        expect(text).toMatch(/"status":"ok"/);
        expect(text).toMatch(/"time":"[^"]+"/);
      });
  });

  it('upload routes require a bearer token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/uploads/image')
      .expect(401);
  });

  it('stores accepted images under random names and serves them publicly', async () => {
    const token = app.get(JwtService).sign(
      {
        sub: 'test-user',
        email: 'test@example.com',
        role: UserRole.USER,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/uploads/image')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('test image'), {
        filename: 'cover.png',
        contentType: 'image/png',
      })
      .expect(201);

    expect(response.text).toMatch(/"mimeType":"image\/png"/);
    const match = /"url":"(\/uploads\/[a-f0-9-]+\.png)"/.exec(response.text);
    if (!match) {
      throw new Error('Upload response did not contain the stored file URL');
    }

    await request(app.getHttpServer()).get(match[1]).expect(200);
  });

  it('rejects uploads when the extension does not match the MIME type', async () => {
    const token = app.get(JwtService).sign(
      {
        sub: 'test-user',
        email: 'test@example.com',
        role: UserRole.USER,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );

    await request(app.getHttpServer())
      .post('/api/v1/uploads/image')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not an image'), {
        filename: 'cover.jpg',
        contentType: 'image/png',
      })
      .expect(400);
  });
});
