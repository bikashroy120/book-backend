import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TokenType, UserRole, UserStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/database/prisma.service';
import { TransformInterceptor } from '../src/common/interceptor/transform.interceptor';
import { rm } from 'node:fs/promises';
import { sha256 } from '../src/common/utils/crypto';
import { MailService } from '../src/core/mail/mail.service';
import type { MailMessage } from '../src/core/mail/mail.types';

type LoginTestUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
  language: string;
  password: string;
  status: UserStatus;
};
type UserLookup = {
  where?: { id?: string; phone?: string };
  select?: Record<string, boolean>;
};
type StoredToken = {
  id: string;
  userId: string;
  type: TokenType;
  expiresAt: Date;
};

describe('AppController (e2e)', () => {
  let app: NestExpressApplication<App>;
  let uploadDirectory: string;
  let loginUser: LoginTestUser | null = null;
  let storedToken: StoredToken | null = null;
  let createdUserToken: string | undefined;
  let createdResetToken: string | undefined;
  let createdStaffPasswordHash: string | undefined;
  let passwordHash: string;
  let duplicatePhoneOwnerId: string | null = null;
  const profileUser = {
    id: 'test-user',
    name: 'Test User',
    email: 'test@example.com',
    phone: '01712345678',
    role: UserRole.USER,
    avatarUrl: null,
    language: 'bn',
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sentMails: MailMessage[] = [];
  const registrationUser = {
    id: 'registered-user',
    name: 'New Reader',
    email: 'reader@example.com',
    phone: '01712345678',
    role: UserRole.USER,
    avatarUrl: null,
    language: 'bn',
  };
  const staffUser = {
    id: 'created-staff',
    name: 'Staff User',
    email: 'staff@example.com',
    phone: null,
    role: UserRole.ADMIN,
    avatarUrl: null,
    language: 'bn',
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
  };
  const transactionMock = {
    user: {
      create: () => Promise.resolve(registrationUser),
      update: () => Promise.resolve({}),
    },
    verificationToken: {
      create: (input: { data: { token: string } }) => {
        createdUserToken = input.data.token;
        return Promise.resolve({});
      },
      deleteMany: () => Promise.resolve({ count: 1 }),
    },
  };
  const prismaMock = {
    user: {
      findUnique: (input?: UserLookup) => {
        if (input?.where?.phone) {
          return Promise.resolve(
            duplicatePhoneOwnerId ? { id: duplicatePhoneOwnerId } : null,
          );
        }
        if (input?.select?.password) {
          return Promise.resolve(loginUser);
        }
        return Promise.resolve(profileUser);
      },
      update: () => Promise.resolve(profileUser),
      create: (input: { data: { password: string } }) => {
        createdStaffPasswordHash = input.data.password;
        return Promise.resolve(staffUser);
      },
    },
    verificationToken: {
      create: (input: { data: { token: string } }) => {
        createdResetToken = input.data.token;
        return Promise.resolve({});
      },
      findUnique: () => Promise.resolve(storedToken),
      delete: () => Promise.resolve({}),
    },
    $transaction: <T>(
      callback: (transaction: typeof transactionMock) => Promise<T>,
    ) => callback(transactionMock),
  };

  beforeAll(async () => {
    const configuredUploadDirectory = process.env.UPLOAD_DIR;
    if (!configuredUploadDirectory) {
      throw new Error('E2E upload directory is not configured');
    }
    uploadDirectory = configuredUploadDirectory;
    passwordHash = await bcrypt.hash('CorrectHorse9', 4);

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(MailService)
      .useValue({
        sendMail: (message: MailMessage) => {
          sentMails.push(message);
          return Promise.resolve();
        },
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useStaticAssets(uploadDirectory, { prefix: '/uploads/' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
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

  it('keeps own-profile routes private and restricts user management to admins', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);

    const userToken = app.get(JwtService).sign(
      {
        sub: 'test-user',
        email: 'test@example.com',
        role: UserRole.USER,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('returns a safe own profile and rejects duplicate phone updates with 409', async () => {
    const userToken = app.get(JwtService).sign(
      {
        sub: 'test-user',
        email: 'test@example.com',
        role: UserRole.USER,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );
    const profile = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(profile.text).toContain('"name":"Test User"');
    expect(profile.text).not.toContain('"password"');

    duplicatePhoneOwnerId = 'another-user';
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ phone: '01812345678' })
      .expect(409);
    duplicatePhoneOwnerId = null;
  });

  it('creates staff with a temporary password emailed through MailService', async () => {
    const superAdminToken = app.get(JwtService).sign(
      {
        sub: 'super-admin',
        email: 'super@example.com',
        role: UserRole.SUPER_ADMIN,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Staff User',
        email: 'staff@example.com',
        role: UserRole.ADMIN,
      })
      .expect(201);

    const temporaryPassword =
      /Temporary password: <strong>([^<]+)<\/strong>/.exec(
        sentMails.at(-1)?.html ?? '',
      )?.[1];
    expect(temporaryPassword).toBeDefined();
    expect(createdStaffPasswordHash).toBeDefined();
    expect(
      await bcrypt.compare(
        temporaryPassword ?? '',
        createdStaffPasswordHash ?? '',
      ),
    ).toBe(true);
    expect(response.text).toContain('"role":"ADMIN"');
    expect(response.text).not.toContain('"password"');
    expect(response.text).not.toContain(temporaryPassword ?? '');
  });

  it('does not let admins create other admins', () => {
    const adminToken = app.get(JwtService).sign(
      {
        sub: 'admin',
        email: 'admin@example.com',
        role: UserRole.ADMIN,
      },
      { secret: process.env.ACCESS_TOKEN_SECRET },
    );

    return request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Staff User',
        email: 'staff@example.com',
        role: UserRole.ADMIN,
      })
      .expect(403);
  });

  it('validates Bangladesh phone numbers and password complexity at registration', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: 'Test User',
        email: 'test@example.com',
        phone: '01234567890',
        password: 'weak',
      })
      .expect(400);
  });

  it('registers a reader, stores a hashed verification token, and omits the password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        name: ' New Reader ',
        email: ' READER@example.com ',
        phone: '01712345678',
        password: 'ReaderPassword9',
      })
      .expect(201);

    expect(response.text).toContain('"name":"New Reader"');
    expect(response.text).toContain('"phone":"01712345678"');
    expect(response.text).not.toContain('"password"');
    expect(createdUserToken).toBeDefined();
    const rawToken = /token=([a-f0-9]{64})/.exec(
      sentMails.at(-1)?.html ?? '',
    )?.[1];
    expect(rawToken).toBeDefined();
    expect(createdUserToken).toBe(sha256(rawToken ?? ''));
  });

  it('logs in and does not return the password hash', async () => {
    loginUser = {
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
      avatarUrl: null,
      language: 'bn',
      password: passwordHash,
      status: UserStatus.ACTIVE,
    };

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'TEST@example.com', password: 'CorrectHorse9' })
      .expect(201);

    expect(response.text).toMatch(/"accessToken":"[^"]+"/);
    expect(response.text).toMatch(/"refreshToken":"[^"]+"/);
    expect(response.text).toContain('"name":"Test User"');
    expect(response.text).toContain('"role":"USER"');
    expect(response.text).not.toContain(passwordHash);
  });

  it('uses the same unauthorized response for unknown users and wrong passwords', async () => {
    loginUser = {
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
      avatarUrl: null,
      language: 'bn',
      password: passwordHash,
      status: UserStatus.ACTIVE,
    };
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'test@example.com', password: 'Incorrect9' })
      .expect(401);

    loginUser = null;
    const unknownUser = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'absent@example.com', password: 'Incorrect9' })
      .expect(401);

    const message = (body: string) => /"message":"([^"]+)"/.exec(body)?.[1];
    expect(message(unknownUser.text)).toBe(message(wrongPassword.text));
  });

  it('rejects suspended users with a clear forbidden response', () => {
    loginUser = {
      id: 'suspended-user',
      name: 'Suspended User',
      email: 'suspended@example.com',
      role: UserRole.USER,
      avatarUrl: null,
      language: 'bn',
      password: passwordHash,
      status: UserStatus.SUSPENDED,
    };

    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'suspended@example.com', password: 'CorrectHorse9' })
      .expect(403)
      .expect(({ text }) => {
        expect(text).toContain('"message":"This account is suspended"');
      });
  });

  it('limits login attempts to five per minute per IP', async () => {
    loginUser = null;
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'absent@example.com', password: 'Incorrect9' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identifier: 'absent@example.com', password: 'Incorrect9' })
      .expect(429);
  });

  it('refreshes an access token after re-reading the user', async () => {
    loginUser = {
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
      avatarUrl: null,
      language: 'bn',
      password: passwordHash,
      status: UserStatus.ACTIVE,
    };
    const refreshToken = app
      .get(JwtService)
      .sign(
        { sub: 'test-user', email: 'test@example.com', role: UserRole.USER },
        { secret: process.env.REFRESH_TOKEN_SECRET, expiresIn: '7d' },
      );

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(201);

    expect(response.text).toMatch(/"accessToken":"[^"]+"/);
    expect(response.text).not.toContain('refreshToken');
  });

  it('uses the same generic forgot-password message for known and unknown emails', async () => {
    loginUser = null;
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'absent@example.com' })
      .expect(201);

    loginUser = {
      id: 'test-user',
      name: 'Test User',
      email: 'test@example.com',
      role: UserRole.USER,
      avatarUrl: null,
      language: 'bn',
      password: passwordHash,
      status: UserStatus.ACTIVE,
    };
    const knownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'test@example.com' })
      .expect(201);

    const message = (body: string) => /"message":"([^"]+)"/.exec(body)?.[1];
    expect(message(knownEmail.text)).toBe(message(unknownEmail.text));
    const resetToken = /token=([a-f0-9]{64})/.exec(
      sentMails.at(-1)?.html ?? '',
    )?.[1];
    expect(resetToken).toBeDefined();
    expect(createdResetToken).toBe(sha256(resetToken ?? ''));
  });

  it('resets the password for a valid reset token', async () => {
    storedToken = {
      id: 'reset-token-id',
      userId: 'test-user',
      type: TokenType.RESET_PASSWORD,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(64), newPassword: 'ChangedPassword9' })
      .expect(201)
      .expect(({ text }) => {
        expect(text).toContain('"message":"Password reset successfully"');
      });
  });

  it('verifies a valid email token and removes it', async () => {
    storedToken = {
      id: 'verify-token-id',
      userId: 'test-user',
      type: TokenType.VERIFY_EMAIL,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await request(app.getHttpServer())
      .get(`/api/v1/auth/verify-email?token=${'b'.repeat(64)}`)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('"message":"Email verified successfully"');
      });
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
