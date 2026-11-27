import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  ManuscriptStatus,
  ManuscriptSubmitType,
  Prisma,
  Priority,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { BooksService } from '../books/books.service';
import { MailService } from '../../core/mail/mail.service';
import { PrismaService } from '../../core/database/prisma.service';
import { AssignManuscriptDTO } from './dto/assign-manuscript.dto';
import { ConvertManuscriptDTO } from './dto/convert-manuscript.dto';
import { CreateManuscriptDTO } from './dto/create-manuscript.dto';
import { ManuscriptFeedbackDTO } from './dto/manuscript-feedback.dto';
import { ManuscriptsQueryDTO } from './dto/manuscripts-query.dto';
import { MyManuscriptsQueryDTO } from './dto/my-manuscripts-query.dto';
import { ResubmitManuscriptDTO } from './dto/resubmit-manuscript.dto';
import { UpdateManuscriptStatusDTO } from './dto/update-manuscript-status.dto';

const authorManuscriptSelect = {
  id: true,
  code: true,
  title: true,
  genre: true,
  submitType: true,
  fileUrl: true,
  textContent: true,
  status: true,
  priority: true,
  submittedAt: true,
  updatedAt: true,
  bookId: true,
} satisfies Prisma.ManuscriptSelect;

const manuscriptDetailSelect = {
  id: true,
  code: true,
  title: true,
  genre: true,
  submitType: true,
  fileUrl: true,
  textContent: true,
  status: true,
  priority: true,
  submittedAt: true,
  updatedAt: true,
  bookId: true,
  author: {
    select: {
      id: true,
      status: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
  editor: { select: { id: true, name: true, role: true } },
  book: { select: { id: true, title: true, slug: true, status: true } },
  feedbacks: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      message: true,
      authorUserId: true,
      createdAt: true,
      user: { select: { id: true, name: true, role: true } },
    },
  },
} satisfies Prisma.ManuscriptSelect;
type ManuscriptDetail = Prisma.ManuscriptGetPayload<{
  select: typeof manuscriptDetailSelect;
}>;

const statusTransitions: Record<ManuscriptStatus, readonly ManuscriptStatus[]> =
  {
    [ManuscriptStatus.SUBMITTED]: [ManuscriptStatus.IN_REVIEW],
    [ManuscriptStatus.IN_REVIEW]: [
      ManuscriptStatus.REVISION_REQUESTED,
      ManuscriptStatus.APPROVED,
      ManuscriptStatus.REJECTED,
    ],
    [ManuscriptStatus.REVISION_REQUESTED]: [ManuscriptStatus.REJECTED],
    [ManuscriptStatus.APPROVED]: [],
    [ManuscriptStatus.REJECTED]: [],
  };

function isPrismaError(
  error: unknown,
  ...codes: string[]
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

function isoDate<T extends { submittedAt: Date; updatedAt: Date }>(value: T) {
  return {
    ...value,
    submittedAt: value.submittedAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

@Injectable()
export class ManuscriptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly booksService: BooksService,
    private readonly mail: MailService,
  ) {}

  async create(authorUserId: string, input: CreateManuscriptDTO) {
    this.validateSubmission(input.submitType, input.fileUrl, input.textContent);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const author = await this.requireApprovedAuthor(
              transaction,
              authorUserId,
            );
            const code = await this.nextCode(transaction);
            const manuscript = await transaction.manuscript.create({
              data: {
                code,
                authorId: author.id,
                title: input.title.trim(),
                genre: input.genre.trim(),
                submitType: input.submitType,
                fileUrl:
                  input.submitType === ManuscriptSubmitType.FILE
                    ? input.fileUrl
                    : null,
                textContent:
                  input.submitType === ManuscriptSubmitType.TEXT
                    ? input.textContent
                    : null,
                status: ManuscriptStatus.SUBMITTED,
                priority: Priority.NORMAL,
              },
              select: authorManuscriptSelect,
            });
            return isoDate(manuscript);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isPrismaError(error, 'P2002', 'P2034') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002', 'P2034')) {
          throw new ConflictException(
            'Could not allocate a manuscript code; please try again',
          );
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not allocate a manuscript code; please try again',
    );
  }

  async findMine(authorUserId: string, query: MyManuscriptsQueryDTO) {
    const author = await this.requireApprovedAuthor(this.prisma, authorUserId);
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.ManuscriptWhereInput = {
      authorId: author.id,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { genre: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [manuscripts, total] = await Promise.all([
      this.prisma.manuscript.findMany({
        where,
        skip,
        take,
        orderBy: { submittedAt: 'desc' },
        select: authorManuscriptSelect,
      }),
      this.prisma.manuscript.count({ where }),
    ]);
    return {
      data: manuscripts.map(isoDate),
      meta: pageMeta(page, limit, total),
    };
  }

  async getMine(authorUserId: string, manuscriptId: string) {
    const author = await this.requireApprovedAuthor(this.prisma, authorUserId);
    const manuscript = await this.prisma.manuscript.findFirst({
      where: { id: manuscriptId, authorId: author.id },
      select: manuscriptDetailSelect,
    });
    if (!manuscript) throw new NotFoundException('Manuscript not found');
    return this.toIsoDetail(manuscript);
  }

  async addAuthorFeedback(
    authorUserId: string,
    manuscriptId: string,
    input: ManuscriptFeedbackDTO,
  ) {
    const author = await this.requireApprovedAuthor(this.prisma, authorUserId);
    const created = await this.prisma.$transaction(async (transaction) => {
      const manuscript = await transaction.manuscript.findFirst({
        where: { id: manuscriptId, authorId: author.id },
        select: { id: true, status: true },
      });
      if (!manuscript) throw new NotFoundException('Manuscript not found');
      if (manuscript.status !== ManuscriptStatus.REVISION_REQUESTED) {
        throw new ConflictException(
          'Feedback can only be sent while a revision is requested',
        );
      }
      return transaction.manuscriptFeedback.create({
        data: {
          manuscriptId,
          authorUserId,
          message: input.message,
        },
        select: {
          id: true,
          manuscriptId: true,
          message: true,
          authorUserId: true,
          createdAt: true,
        },
      });
    });
    return { ...created, createdAt: created.createdAt.toISOString() };
  }

  async resubmit(
    authorUserId: string,
    manuscriptId: string,
    input: ResubmitManuscriptDTO,
  ) {
    const author = await this.requireApprovedAuthor(this.prisma, authorUserId);
    const result = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.manuscript.findFirst({
        where: { id: manuscriptId, authorId: author.id },
        select: {
          id: true,
          title: true,
          submitType: true,
          status: true,
          author: {
            select: { user: { select: { email: true, name: true } } },
          },
        },
      });
      if (!current) throw new NotFoundException('Manuscript not found');
      if (current.status !== ManuscriptStatus.REVISION_REQUESTED) {
        throw new ConflictException(
          'Only manuscripts with a requested revision can be resubmitted',
        );
      }

      const submitType = input.submitType ?? current.submitType;
      this.validateSubmission(submitType, input.fileUrl, input.textContent);
      const updated = await transaction.manuscript.updateMany({
        where: {
          id: manuscriptId,
          authorId: author.id,
          status: ManuscriptStatus.REVISION_REQUESTED,
        },
        data: {
          submitType,
          fileUrl:
            submitType === ManuscriptSubmitType.FILE ? input.fileUrl : null,
          textContent:
            submitType === ManuscriptSubmitType.TEXT ? input.textContent : null,
          status: ManuscriptStatus.SUBMITTED,
          submittedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'The manuscript status changed; refresh and try again',
        );
      }
      return {
        manuscript: await transaction.manuscript.findUniqueOrThrow({
          where: { id: manuscriptId },
          select: authorManuscriptSelect,
        }),
        authorName: current.author.user.name,
        authorEmail: current.author.user.email,
        title: current.title,
      };
    });

    await this.notifyStatusChange(
      result.authorEmail,
      result.authorName,
      result.title,
      ManuscriptStatus.SUBMITTED,
    );
    return isoDate(result.manuscript);
  }

  async findAll(query: ManuscriptsQueryDTO) {
    this.validateDateRange(query.from, query.to);
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const statsWhere = this.staffWhere(query, false);
    const where = this.staffWhere(query, true);
    const [manuscripts, matchingTotal, statusGroups] = await Promise.all([
      this.prisma.manuscript.findMany({
        where,
        skip,
        take,
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          code: true,
          title: true,
          genre: true,
          submitType: true,
          status: true,
          priority: true,
          submittedAt: true,
          updatedAt: true,
          author: {
            select: {
              id: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
          editor: { select: { id: true, name: true } },
          bookId: true,
        },
      }),
      this.prisma.manuscript.count({ where }),
      this.prisma.manuscript.groupBy({
        by: ['status'],
        where: statsWhere,
        _count: { _all: true },
      }),
    ]);
    const statusCounts = new Map(
      statusGroups.map((group) => [group.status, group._count._all]),
    );
    const allStatusTotal = statusGroups.reduce(
      (sum, group) => sum + group._count._all,
      0,
    );
    return {
      data: manuscripts.map(isoDate),
      meta: {
        ...pageMeta(page, limit, matchingTotal),
        stats: {
          total: allStatusTotal,
          submitted: statusCounts.get(ManuscriptStatus.SUBMITTED) ?? 0,
          inReview: statusCounts.get(ManuscriptStatus.IN_REVIEW) ?? 0,
          revisionRequested:
            statusCounts.get(ManuscriptStatus.REVISION_REQUESTED) ?? 0,
          approved: statusCounts.get(ManuscriptStatus.APPROVED) ?? 0,
          rejected: statusCounts.get(ManuscriptStatus.REJECTED) ?? 0,
        },
      },
    };
  }

  async getById(manuscriptId: string) {
    const manuscript = await this.prisma.manuscript.findUnique({
      where: { id: manuscriptId },
      select: manuscriptDetailSelect,
    });
    if (!manuscript) throw new NotFoundException('Manuscript not found');
    return this.toIsoDetail(manuscript);
  }

  async assignEditor(manuscriptId: string, input: AssignManuscriptDTO) {
    const [manuscript, editor] = await Promise.all([
      this.prisma.manuscript.findUnique({
        where: { id: manuscriptId },
        select: { id: true },
      }),
      this.prisma.user.findFirst({
        where: {
          id: input.editorId,
          status: UserStatus.ACTIVE,
          role: { in: [UserRole.ADMIN, UserRole.WORKER] },
        },
        select: { id: true },
      }),
    ]);
    if (!manuscript) throw new NotFoundException('Manuscript not found');
    if (!editor) {
      throw new BadRequestException('Editor must be an active ADMIN or WORKER');
    }
    return this.prisma.manuscript.update({
      where: { id: manuscriptId },
      data: { editorId: editor.id },
      select: { id: true, code: true, editorId: true },
    });
  }

  async updateStatus(manuscriptId: string, input: UpdateManuscriptStatusDTO) {
    const result = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.manuscript.findUnique({
        where: { id: manuscriptId },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          author: {
            select: { user: { select: { email: true, name: true } } },
          },
        },
      });
      if (!current) throw new NotFoundException('Manuscript not found');
      if (
        input.status !== current.status &&
        !statusTransitions[current.status].includes(input.status)
      ) {
        throw new BadRequestException(
          `Cannot change manuscript status from ${current.status} to ${input.status}`,
        );
      }
      const updated = await transaction.manuscript.updateMany({
        where: { id: manuscriptId, status: current.status },
        data: {
          status: input.status,
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'The manuscript status changed; refresh and try again',
        );
      }
      return {
        manuscript: await transaction.manuscript.findUniqueOrThrow({
          where: { id: manuscriptId },
          select: manuscriptDetailSelect,
        }),
        previousStatus: current.status,
        authorName: current.author.user.name,
        authorEmail: current.author.user.email,
        title: current.title,
      };
    });

    if (result.previousStatus !== input.status) {
      await this.notifyStatusChange(
        result.authorEmail,
        result.authorName,
        result.title,
        input.status,
      );
    }
    return this.toIsoDetail(result.manuscript);
  }

  async addStaffFeedback(
    staffUserId: string,
    manuscriptId: string,
    input: ManuscriptFeedbackDTO,
  ) {
    const manuscript = await this.prisma.manuscript.findUnique({
      where: { id: manuscriptId },
      select: { id: true },
    });
    if (!manuscript) throw new NotFoundException('Manuscript not found');
    const feedback = await this.prisma.manuscriptFeedback.create({
      data: {
        manuscriptId,
        authorUserId: staffUserId,
        message: input.message,
      },
      select: {
        id: true,
        manuscriptId: true,
        message: true,
        authorUserId: true,
        createdAt: true,
      },
    });
    return { ...feedback, createdAt: feedback.createdAt.toISOString() };
  }

  async convertToBook(
    editorId: string,
    manuscriptId: string,
    input: ConvertManuscriptDTO,
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const manuscript = await transaction.manuscript.findUnique({
              where: { id: manuscriptId },
              select: {
                id: true,
                title: true,
                genre: true,
                authorId: true,
                status: true,
                bookId: true,
                author: { select: { user: { select: { name: true } } } },
              },
            });
            if (!manuscript) {
              throw new NotFoundException('Manuscript not found');
            }
            if (manuscript.status !== ManuscriptStatus.APPROVED) {
              throw new ConflictException(
                'Only approved manuscripts can be converted to a book',
              );
            }
            if (manuscript.bookId) {
              throw new ConflictException(
                'This manuscript has already been converted to a book',
              );
            }

            const categoryId =
              input.categoryId ??
              (
                await transaction.category.findFirst({
                  where: {
                    OR: [
                      { nameBn: manuscript.genre },
                      {
                        nameEn: {
                          equals: manuscript.genre,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                  select: { id: true },
                })
              )?.id;
            if (!categoryId) {
              throw new NotFoundException(
                'No category matches the manuscript genre; provide categoryId',
              );
            }

            const book = await this.booksService.createFromManuscript(
              transaction,
              editorId,
              {
                title: manuscript.title,
                authorId: manuscript.authorId,
                authorName: manuscript.author.user.name,
                categoryId,
                publisherId: input.publisherId,
              },
            );
            const linked = await transaction.manuscript.updateMany({
              where: {
                id: manuscript.id,
                status: ManuscriptStatus.APPROVED,
                bookId: null,
              },
              data: { bookId: book.id },
            });
            if (linked.count !== 1) {
              throw new ConflictException(
                'The manuscript was converted by another request',
              );
            }
            return {
              manuscript: await transaction.manuscript.findUniqueOrThrow({
                where: { id: manuscript.id },
                select: { id: true, code: true, status: true, bookId: true },
              }),
              book,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isPrismaError(error, 'P2002', 'P2034') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002', 'P2034')) {
          throw new ConflictException(
            'Could not create a unique book record; please try again',
          );
        }
        throw error;
      }
    }
    throw new ConflictException(
      'Could not create a unique book record; please try again',
    );
  }

  private async requireApprovedAuthor(
    source: Pick<Prisma.TransactionClient, 'authorProfile'>,
    userId: string,
  ) {
    const profile = await source.authorProfile.findUnique({
      where: { userId },
      select: { id: true, status: true, agreedToTermsAt: true },
    });
    if (
      !profile ||
      profile.status !== ApprovalStatus.APPROVED ||
      !profile.agreedToTermsAt
    ) {
      throw new ForbiddenException(
        'An approved author profile and agreed terms are required',
      );
    }
    return profile;
  }

  private async nextCode(
    transaction: Prisma.TransactionClient,
  ): Promise<string> {
    const manuscripts = await transaction.manuscript.findMany({
      where: { code: { startsWith: 'manuscript-' } },
      select: { code: true },
    });
    const maxSequence = manuscripts.reduce((max, manuscript) => {
      const match = /^manuscript-(\d+)$/.exec(manuscript.code ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `manuscript-${maxSequence + 1}`;
  }

  private validateSubmission(
    submitType: ManuscriptSubmitType,
    fileUrl?: string | null,
    textContent?: string | null,
  ) {
    if (
      submitType === ManuscriptSubmitType.FILE &&
      (!fileUrl || fileUrl.trim().length === 0)
    ) {
      throw new BadRequestException('fileUrl is required for FILE submissions');
    }
    if (
      submitType === ManuscriptSubmitType.TEXT &&
      (!textContent || textContent.trim().length < 500)
    ) {
      throw new BadRequestException(
        'textContent must contain at least 500 characters for TEXT submissions',
      );
    }
  }

  private staffWhere(
    query: ManuscriptsQueryDTO,
    includeStatus: boolean,
  ): Prisma.ManuscriptWhereInput {
    return {
      ...(includeStatus && query.status ? { status: query.status } : {}),
      ...(query.genre
        ? { genre: { contains: query.genre, mode: 'insensitive' } }
        : {}),
      ...(query.editorId ? { editorId: query.editorId } : {}),
      ...(query.from || query.to
        ? {
            submittedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              {
                author: {
                  is: {
                    user: {
                      is: {
                        name: {
                          contains: query.search,
                          mode: 'insensitive',
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private validateDateRange(from?: Date, to?: Date) {
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from cannot be later than to');
    }
  }

  private async notifyStatusChange(
    email: string,
    authorName: string,
    title: string,
    status: ManuscriptStatus,
  ) {
    const safeName = escapeHtml(authorName);
    const safeTitle = escapeHtml(title);
    await this.mail.sendMail({
      to: email,
      subject: `Manuscript status updated: ${status}`,
      html: `<p>Hello ${safeName},</p><p>The manuscript "${safeTitle}" is now ${status.replace(/_/g, ' ').toLowerCase()}.</p>`,
    });
  }

  private toIsoDetail(manuscript: ManuscriptDetail) {
    return {
      ...manuscript,
      submittedAt: manuscript.submittedAt.toISOString(),
      updatedAt: manuscript.updatedAt.toISOString(),
      feedbacks: manuscript.feedbacks.map((feedback) => ({
        ...feedback,
        createdAt: feedback.createdAt.toISOString(),
      })),
    };
  }
}
