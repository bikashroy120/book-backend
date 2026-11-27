import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ApprovalStatus,
  ManuscriptStatus,
  ManuscriptSubmitType,
  Priority,
  Prisma,
} from '@prisma/client';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/database/prisma.service';
import { BooksService } from '../books/books.service';
import { ConvertManuscriptDTO } from './dto/convert-manuscript.dto';
import { CreateManuscriptDTO } from './dto/create-manuscript.dto';
import { ManuscriptsService } from './manuscripts.service';

describe('ManuscriptsService', () => {
  it('requires an approved author profile with accepted terms', async () => {
    const transaction = {
      authorProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'author-1',
          status: ApprovalStatus.PENDING,
          agreedToTermsAt: new Date(),
        }),
      },
    };
    const transactionRunner = jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const prisma = {
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const service = new ManuscriptsService(
      prisma,
      {} as BooksService,
      { sendMail: jest.fn() } as unknown as MailService,
    );
    const input: CreateManuscriptDTO = {
      title: 'A new manuscript',
      genre: 'Fiction',
      submitType: ManuscriptSubmitType.TEXT,
      textContent: 'x'.repeat(500),
    };

    await expect(service.create('author-user-1', input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allocates a sequential manuscript code and stores submitted text', async () => {
    const createdAt = new Date('2026-11-27T12:00:00.000Z');
    let createData: Prisma.ManuscriptCreateArgs['data'] | undefined;
    const transaction = {
      authorProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'author-1',
          status: ApprovalStatus.APPROVED,
          agreedToTermsAt: createdAt,
        }),
      },
      manuscript: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { code: 'manuscript-8' },
            { code: 'other-code' },
          ]),
        create: jest
          .fn()
          .mockImplementation(
            (input: { data: Prisma.ManuscriptCreateArgs['data'] }) => {
              createData = input.data;
              return Promise.resolve({
                id: 'manuscript-id',
                code: input.data.code,
                title: input.data.title,
                genre: input.data.genre,
                submitType: input.data.submitType,
                fileUrl: input.data.fileUrl,
                textContent: input.data.textContent,
                status: input.data.status,
                priority: input.data.priority,
                submittedAt: createdAt,
                updatedAt: createdAt,
                bookId: null,
              });
            },
          ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new ManuscriptsService(
      prisma,
      {} as BooksService,
      { sendMail: jest.fn() } as unknown as MailService,
    );
    const input: CreateManuscriptDTO = {
      title: 'A new manuscript',
      genre: 'Fiction',
      submitType: ManuscriptSubmitType.TEXT,
      textContent: 'x'.repeat(500),
    };

    await expect(service.create('author-user-1', input)).resolves.toMatchObject(
      {
        code: 'manuscript-9',
        status: ManuscriptStatus.SUBMITTED,
        submittedAt: createdAt.toISOString(),
      },
    );
    expect(createData).toMatchObject({
      code: 'manuscript-9',
      authorId: 'author-1',
      status: ManuscriptStatus.SUBMITTED,
      priority: Priority.NORMAL,
      fileUrl: null,
      textContent: 'x'.repeat(500),
    });
  });

  it('converts an approved manuscript to a linked book in one transaction', async () => {
    const manuscriptFind = jest.fn().mockResolvedValue({
      id: 'manuscript-1',
      title: 'Book title',
      genre: 'Fiction',
      authorId: 'author-1',
      status: ManuscriptStatus.APPROVED,
      bookId: null,
      author: { user: { name: 'Author Name' } },
    });
    const transaction = {
      manuscript: {
        findUnique: manuscriptFind,
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'manuscript-1',
          code: 'manuscript-1',
          status: ManuscriptStatus.APPROVED,
          bookId: 'book-1',
        }),
      },
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
    };
    const transactionRunner = jest.fn(
      (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    );
    const prisma = {
      $transaction: transactionRunner,
    } as unknown as PrismaService;
    const createFromManuscript = jest.fn().mockResolvedValue({
      id: 'book-1',
      title: 'Book title',
    });
    const service = new ManuscriptsService(
      prisma,
      { createFromManuscript } as unknown as BooksService,
      { sendMail: jest.fn() } as unknown as MailService,
    );
    const input: ConvertManuscriptDTO = { publisherId: 'publisher-1' };

    await expect(
      service.convertToBook('admin-1', 'manuscript-1', input),
    ).resolves.toMatchObject({
      manuscript: { bookId: 'book-1' },
      book: { id: 'book-1' },
    });
    expect(transactionRunner).toHaveBeenCalledTimes(1);
    expect(createFromManuscript).toHaveBeenCalledWith(transaction, 'admin-1', {
      title: 'Book title',
      authorId: 'author-1',
      authorName: 'Author Name',
      categoryId: 'category-1',
      publisherId: 'publisher-1',
    });
  });

  it('keeps paginated totals filtered while status stats cover the full query', async () => {
    const now = new Date('2026-11-27T12:00:00.000Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'manuscript-1',
        code: 'manuscript-1',
        title: 'Book title',
        genre: 'Fiction',
        submitType: ManuscriptSubmitType.TEXT,
        status: ManuscriptStatus.SUBMITTED,
        priority: Priority.NORMAL,
        submittedAt: now,
        updatedAt: now,
        author: {
          id: 'author-1',
          user: { id: 'user-1', name: 'Author', email: 'author@example.com' },
        },
        editor: null,
        bookId: null,
      },
    ]);
    const count = jest.fn().mockResolvedValue(1);
    const groupBy = jest.fn().mockResolvedValue([
      { status: ManuscriptStatus.SUBMITTED, _count: { _all: 1 } },
      { status: ManuscriptStatus.APPROVED, _count: { _all: 2 } },
    ]);
    const service = new ManuscriptsService(
      { manuscript: { findMany, count, groupBy } } as unknown as PrismaService,
      {} as BooksService,
      { sendMail: jest.fn() } as unknown as MailService,
    );

    const result = await service.findAll({
      status: ManuscriptStatus.SUBMITTED,
    });

    expect(count).toHaveBeenCalledWith({
      where: { status: ManuscriptStatus.SUBMITTED },
    });
    expect(result.meta).toMatchObject({
      total: 1,
      stats: { total: 3, submitted: 1, approved: 2 },
    });
  });

  it('rejects invalid status jumps without updating or notifying', async () => {
    const updateMany = jest.fn();
    const transaction = {
      manuscript: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'manuscript-1',
          title: 'Book title',
          status: ManuscriptStatus.SUBMITTED,
          priority: Priority.NORMAL,
          author: { user: { email: 'author@example.com', name: 'Author' } },
        }),
        updateMany,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const sendMail = jest.fn();
    const service = new ManuscriptsService(
      prisma,
      {} as BooksService,
      { sendMail } as unknown as MailService,
    );

    await expect(
      service.updateStatus('manuscript-1', {
        status: ManuscriptStatus.APPROVED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
