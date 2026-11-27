import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  ApprovalStatus,
  TokenType,
  UserRole,
  UserStatus,
} from '@prisma/client';
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
import { AuthorsService } from '../src/modules/authors/authors.service';

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
type TestAddress = {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  division: string;
  district: string;
  upazila: string;
  details: string;
  type: string;
  isDefault: boolean;
  createdAt: Date;
};
type TestAddressWhere = {
  id?: string | { not: string };
  userId?: string;
  isDefault?: boolean;
};
type TestAddressInput = {
  where?: TestAddressWhere;
  data?: Partial<TestAddress>;
  orderBy?: Array<Record<string, string>>;
};
type TestAuthorApplication = {
  id: string;
  applicantId: string;
  introduction: string;
  writingSample: string;
  motivation: string;
  status: ApprovalStatus;
  reviewNote: string | null;
  reviewerId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};
type TestAuthorProfile = {
  id: string;
  userId: string;
  bio: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  isVerified: boolean;
  status: ApprovalStatus;
  agreedToTermsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  let currentUserRole = UserRole.USER;
  let nextApplicationId = 1;
  let nextAuthorProfileId = 1;
  const testAddresses: TestAddress[] = [];
  const testApplications: TestAuthorApplication[] = [];
  const testAuthorProfiles: TestAuthorProfile[] = [];
  let nextAddressId = 1;
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
  const applicationApplicant = {
    id: 'application-user',
    name: 'Applicant Name',
    email: 'applicant@example.com',
  };
  const matchesApplicationWhere = (
    application: TestAuthorApplication,
    where: {
      id?: string;
      applicantId?: string;
      status?: ApprovalStatus;
    } = {},
  ) =>
    (!where.id || application.id === where.id) &&
    (!where.applicantId || application.applicantId === where.applicantId) &&
    (!where.status || application.status === where.status);
  const applicationMock = {
    create: (input: {
      data: Omit<
        TestAuthorApplication,
        | 'id'
        | 'status'
        | 'reviewNote'
        | 'reviewerId'
        | 'reviewedAt'
        | 'createdAt'
      >;
    }) => {
      const application: TestAuthorApplication = {
        ...input.data,
        id: `application-${nextApplicationId++}`,
        status: ApprovalStatus.PENDING,
        reviewNote: null,
        reviewerId: null,
        reviewedAt: null,
        createdAt: new Date(),
      };
      testApplications.push(application);
      return Promise.resolve(application);
    },
    findFirst: (input: {
      where: { applicantId?: string; status?: ApprovalStatus };
      orderBy?: { createdAt: string };
    }) => {
      const result = testApplications
        .filter((application) =>
          matchesApplicationWhere(application, input.where),
        )
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        )[0];
      return Promise.resolve(result ?? null);
    },
    findUnique: (input: { where: { id: string } }) => {
      const application = testApplications.find(
        (entry) => entry.id === input.where.id,
      );
      return Promise.resolve(
        application
          ? {
              ...application,
              applicant: applicationApplicant,
            }
          : null,
      );
    },
    findMany: (input: {
      where?: { status?: ApprovalStatus };
      skip?: number;
      take?: number;
    }) =>
      Promise.resolve(
        testApplications
          .filter((application) =>
            matchesApplicationWhere(application, input.where),
          )
          .slice(input.skip ?? 0, (input.skip ?? 0) + (input.take ?? 20))
          .map((application) => ({
            ...application,
            applicant: applicationApplicant,
          })),
      ),
    updateMany: (input: {
      where: { id: string; status?: ApprovalStatus };
      data: Partial<TestAuthorApplication>;
    }) => {
      const application = testApplications.find((entry) =>
        matchesApplicationWhere(entry, input.where),
      );
      if (!application) return Promise.resolve({ count: 0 });
      Object.assign(application, input.data);
      return Promise.resolve({ count: 1 });
    },
    count: (input: { where?: { status?: ApprovalStatus } } = {}) =>
      Promise.resolve(
        testApplications.filter((application) =>
          matchesApplicationWhere(application, input.where),
        ).length,
      ),
  };
  const authorProfileMock = {
    findUnique: (input: { where: { id?: string; userId?: string } }) => {
      const profile = testAuthorProfiles.find(
        (entry) =>
          (!input.where.id || entry.id === input.where.id) &&
          (!input.where.userId || entry.userId === input.where.userId),
      );
      return Promise.resolve(
        profile
          ? {
              ...profile,
              user: { name: applicationApplicant.name, avatarUrl: null },
            }
          : null,
      );
    },
    findFirst: (input: { where: { id: string; status: ApprovalStatus } }) => {
      const profile = testAuthorProfiles.find(
        (entry) =>
          entry.id === input.where.id && entry.status === input.where.status,
      );
      return Promise.resolve(
        profile
          ? {
              ...profile,
              user: { name: applicationApplicant.name, avatarUrl: null },
              books: [],
            }
          : null,
      );
    },
    findMany: () =>
      Promise.resolve(
        testAuthorProfiles.map((profile) => ({
          ...profile,
          user: { name: applicationApplicant.name, avatarUrl: null },
          _count: { books: 0 },
        })),
      ),
    create: (input: {
      data: { userId: string; status: ApprovalStatus; isVerified: boolean };
    }) => {
      const profile: TestAuthorProfile = {
        id: `author-${nextAuthorProfileId++}`,
        userId: input.data.userId,
        bio: null,
        facebookUrl: null,
        instagramUrl: null,
        websiteUrl: null,
        isVerified: input.data.isVerified,
        status: input.data.status,
        agreedToTermsAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      testAuthorProfiles.push(profile);
      return Promise.resolve(profile);
    },
    update: (input: {
      where: { id: string };
      data: Partial<TestAuthorProfile>;
    }) => {
      const profile = testAuthorProfiles.find(
        (entry) => entry.id === input.where.id,
      );
      if (!profile)
        return Promise.reject(new Error('Author profile not found'));
      Object.assign(profile, input.data);
      return Promise.resolve(profile);
    },
    count: () => Promise.resolve(testAuthorProfiles.length),
  };
  const matchesAddressWhere = (
    address: TestAddress,
    where: TestAddressWhere = {},
  ) => {
    const matchesId =
      typeof where.id === 'string'
        ? address.id === where.id
        : where.id && 'not' in where.id
          ? address.id !== where.id.not
          : true;
    return (
      matchesId &&
      (!where.userId || address.userId === where.userId) &&
      (where.isDefault === undefined || address.isDefault === where.isDefault)
    );
  };
  const addressMock = {
    findMany: (input: TestAddressInput) => {
      const results = testAddresses
        .filter((address) => matchesAddressWhere(address, input.where))
        .sort(
          (left, right) =>
            Number(right.isDefault) - Number(left.isDefault) ||
            right.createdAt.getTime() - left.createdAt.getTime(),
        );
      return Promise.resolve(results);
    },
    count: (input: TestAddressInput) =>
      Promise.resolve(
        testAddresses.filter((address) =>
          matchesAddressWhere(address, input.where),
        ).length,
      ),
    create: (input: { data: Omit<TestAddress, 'id' | 'createdAt'> }) => {
      const address: TestAddress = {
        ...input.data,
        id: `address-${nextAddressId++}`,
        createdAt: new Date(),
      };
      testAddresses.push(address);
      return Promise.resolve(address);
    },
    updateMany: (input: TestAddressInput) => {
      const matches = testAddresses.filter((address) =>
        matchesAddressWhere(address, input.where),
      );
      for (const address of matches) {
        Object.assign(address, input.data);
      }
      return Promise.resolve({ count: matches.length });
    },
    findFirst: (input: TestAddressInput) => {
      const result = testAddresses
        .filter((address) => matchesAddressWhere(address, input.where))
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )[0];
      return Promise.resolve(result ?? null);
    },
    update: (input: {
      where: { id: string; userId: string };
      data: Partial<TestAddress>;
    }) => {
      const address = testAddresses.find(
        (entry) =>
          entry.id === input.where.id && entry.userId === input.where.userId,
      );
      if (!address) {
        return Promise.reject(new Error('Address not found'));
      }
      Object.assign(address, input.data);
      return Promise.resolve(address);
    },
    delete: (input: { where: { id: string } }) => {
      const index = testAddresses.findIndex(
        (address) => address.id === input.where.id,
      );
      if (index < 0) {
        return Promise.reject(new Error('Address not found'));
      }
      return Promise.resolve(testAddresses.splice(index, 1)[0]);
    },
  };
  const transactionMock = {
    user: {
      findUnique: () => Promise.resolve({ role: currentUserRole }),
      create: () => Promise.resolve(registrationUser),
      update: (input: { data: { role?: UserRole } }) => {
        if (input.data.role) currentUserRole = input.data.role;
        return Promise.resolve({});
      },
    },
    verificationToken: {
      create: (input: { data: { token: string } }) => {
        createdUserToken = input.data.token;
        return Promise.resolve({});
      },
      deleteMany: () => Promise.resolve({ count: 1 }),
    },
    address: addressMock,
    authorApplication: applicationMock,
    authorProfile: authorProfileMock,
  };
  const prismaMock = {
    user: {
      findUnique: (input?: UserLookup) => {
        if (input?.where?.phone) {
          return Promise.resolve(
            duplicatePhoneOwnerId ? { id: duplicatePhoneOwnerId } : null,
          );
        }
        if (input?.select?.role && Object.keys(input.select).length === 1) {
          return Promise.resolve({ role: currentUserRole });
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
      count: () => Promise.resolve(currentUserRole === UserRole.AUTHOR ? 1 : 0),
    },
    verificationToken: {
      create: (input: { data: { token: string } }) => {
        createdResetToken = input.data.token;
        return Promise.resolve({});
      },
      findUnique: () => Promise.resolve(storedToken),
      delete: () => Promise.resolve({}),
    },
    address: addressMock,
    authorApplication: applicationMock,
    authorProfile: authorProfileMock,
    $transaction: <T>(
      callback: (transaction: typeof transactionMock) => Promise<T>,
    ) => callback(transactionMock),
  };
  const accessTokenFor = (id: string, role = UserRole.USER) =>
    app
      .get(JwtService)
      .sign(
        { sub: id, email: `${id}@example.com`, role },
        { secret: process.env.ACCESS_TOKEN_SECRET },
      );

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
    await request(app.getHttpServer()).get('/api/v1/addresses').expect(401);

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

  it('scopes addresses to the current user and makes the first one default', async () => {
    testAddresses.splice(0);
    const token = accessTokenFor('address-owner');
    const response = await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Address Owner',
        phone: '01712345678',
        division: 'Dhaka',
        district: 'Dhaka',
        upazila: 'Dhanmondi',
        details: 'Road 1',
      })
      .expect(201);

    expect(response.text).toContain('"isDefault":true');
    expect(testAddresses[0].userId).toBe('address-owner');

    await request(app.getHttpServer())
      .get('/api/v1/addresses')
      .set('Authorization', `Bearer ${accessTokenFor('other-user')}`)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('"data":[]');
      });
  });

  it('replaces the default atomically when a new default address is created', async () => {
    testAddresses.splice(0);
    const token = accessTokenFor('address-owner');
    const first = {
      fullName: 'Address Owner',
      phone: '01712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      upazila: 'Dhanmondi',
      details: 'First',
    };
    await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send(first)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...first, details: 'Second', isDefault: true })
      .expect(201);

    expect(testAddresses).toHaveLength(2);
    expect(testAddresses.filter((address) => address.isDefault)).toHaveLength(
      1,
    );
    expect(testAddresses.find((address) => address.isDefault)?.details).toBe(
      'Second',
    );
  });

  it('enforces the ten-address limit and checks ownership on each address route', async () => {
    testAddresses.splice(0);
    const token = accessTokenFor('address-owner');
    const input = {
      fullName: 'Address Owner',
      phone: '01712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      upazila: 'Dhanmondi',
      details: 'Address',
    };

    for (let index = 0; index < 10; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/addresses')
        .set('Authorization', `Bearer ${token}`)
        .send(input)
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send(input)
      .expect(409);

    const foreignAddress: TestAddress = {
      id: 'foreign-address',
      userId: 'another-owner',
      fullName: 'Other User',
      phone: '01712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      upazila: 'Dhanmondi',
      details: 'Private',
      type: 'HOME',
      isDefault: false,
      createdAt: new Date(),
    };
    testAddresses.push(foreignAddress);
    const otherToken = accessTokenFor('address-owner');

    await request(app.getHttpServer())
      .patch('/api/v1/addresses/foreign-address')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ details: 'Changed' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/addresses/foreign-address/default')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete('/api/v1/addresses/foreign-address')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('returns 404 for another user address and promotes the newest after deleting the default', async () => {
    testAddresses.splice(0);
    const oldAddress: TestAddress = {
      id: 'old-address',
      userId: 'address-owner',
      fullName: 'Owner',
      phone: '01712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      upazila: 'Dhanmondi',
      details: 'Old remaining address',
      type: 'HOME',
      isDefault: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const defaultAddress: TestAddress = {
      ...oldAddress,
      id: 'default-address',
      details: 'Default address',
      isDefault: true,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    testAddresses.push(oldAddress, defaultAddress);
    const token = accessTokenFor('address-owner');
    const otherToken = accessTokenFor('another-owner');

    await request(app.getHttpServer())
      .delete('/api/v1/addresses/default-address')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete('/api/v1/addresses/default-address')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(testAddresses).toHaveLength(1);
    expect(testAddresses[0].id).toBe('old-address');
    expect(testAddresses[0].isDefault).toBe(true);
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

  it('lets a reader apply once while an application is pending', async () => {
    testApplications.splice(0);
    currentUserRole = UserRole.USER;
    const token = accessTokenFor('application-user');
    const application = {
      introduction: 'I have written stories for many years.',
      writingSample: 'This writing sample is at least twenty characters.',
      motivation: 'I want to publish books for local readers.',
    };

    await request(app.getHttpServer())
      .post('/api/v1/author-applications')
      .set('Authorization', `Bearer ${token}`)
      .send(application)
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/author-applications/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('"status":"PENDING"');
      });
    await request(app.getHttpServer())
      .post('/api/v1/author-applications')
      .set('Authorization', `Bearer ${token}`)
      .send(application)
      .expect(409);
  });

  it('reviews a pending application in one transaction and creates a verified author', async () => {
    const application = testApplications.find(
      (entry) => entry.applicantId === 'application-user',
    );
    if (!application) throw new Error('Expected the reader application');
    const adminToken = accessTokenFor('reviewing-admin', UserRole.ADMIN);

    await request(app.getHttpServer())
      .patch(`/api/v1/author-applications/${application.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED', reviewNote: 'Welcome as an author.' })
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('"status":"APPROVED"');
        expect(text).toContain('"reviewerId":"reviewing-admin"');
      });

    expect(currentUserRole).toBe(UserRole.AUTHOR);
    expect(testAuthorProfiles).toHaveLength(1);
    expect(testAuthorProfiles[0].status).toBe(ApprovalStatus.APPROVED);
    expect(testAuthorProfiles[0].isVerified).toBe(true);
    expect(
      sentMails.some(
        (message) =>
          message.to === 'applicant@example.com' &&
          message.subject.includes('approved'),
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .patch(`/api/v1/author-applications/${application.id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' })
      .expect(409);
  });

  it('allows authors to edit their profile and record terms agreement', async () => {
    const authorToken = accessTokenFor('application-user', UserRole.AUTHOR);
    await request(app.getHttpServer())
      .patch('/api/v1/authors/me')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        bio: 'A short author biography.',
        facebookUrl: 'https://facebook.com/author',
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/authors/me')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ websiteUrl: 'not-a-url' })
      .expect(400);

    await expect(
      app.get(AuthorsService).assertTermsAgreed('application-user'),
    ).rejects.toThrow('You must agree to the author terms');
    await request(app.getHttpServer())
      .post('/api/v1/authors/me/agree-terms')
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(201);
    await expect(
      app.get(AuthorsService).assertTermsAgreed('application-user'),
    ).resolves.toBeUndefined();
    await request(app.getHttpServer())
      .get('/api/v1/authors/me/terms-status')
      .set('Authorization', `Bearer ${authorToken}`)
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('"hasAgreed":true');
      });
  });

  it('exposes approved authors publicly and permits staff directory reads', async () => {
    const workerToken = accessTokenFor('staff-user', UserRole.WORKER);
    await request(app.getHttpServer())
      .get('/api/v1/authors')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/authors/summary')
      .set('Authorization', `Bearer ${workerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/authors/author-1/status')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ status: 'APPROVED' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/public/authors/author-1')
      .expect(200)
      .expect(({ text }) => {
        expect(text).toContain('"name":"Applicant Name"');
      });
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
