import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalStatus, BookStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { MailService } from '../../core/mail/mail.service';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import type { AuthUser } from '../../common/types/auth-user';
import type { AuthorApplicationsQueryDTO } from './dto/author-applications-query.dto';
import type { AuthorsQueryDTO } from './dto/authors-query.dto';
import type { CreateAuthorApplicationDTO } from './dto/create-author-application.dto';
import type { ReviewAuthorApplicationDTO } from './dto/review-author-application.dto';
import type { UpdateAuthorProfileDTO } from './dto/update-author-profile.dto';
import { RoyaltyService } from '../royalties/royalty.service';

const authorProfileSelect = {
  id: true,
  userId: true,
  bio: true,
  facebookUrl: true,
  instagramUrl: true,
  websiteUrl: true,
  isVerified: true,
  status: true,
  agreedToTermsAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const zeroBalance = () => ({
  earned: new Prisma.Decimal(0),
  paid: new Prisma.Decimal(0),
  due: new Prisma.Decimal(0),
  pendingWithdraw: new Prisma.Decimal(0),
});

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

@Injectable()
export class AuthorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly royaltyService: RoyaltyService,
  ) {}

  async createApplication(userId: string, input: CreateAuthorApplicationDTO) {
    return this.prisma.$transaction(
      async (transaction) => {
        const user = await transaction.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });
        if (!user) {
          throw new NotFoundException('User not found');
        }
        if (user.role === UserRole.AUTHOR) {
          throw new ConflictException('You are already an author');
        }

        const pendingApplication =
          await transaction.authorApplication.findFirst({
            where: { applicantId: userId, status: ApprovalStatus.PENDING },
            select: { id: true },
          });
        if (pendingApplication) {
          throw new ConflictException(
            'You already have a pending author application',
          );
        }

        return transaction.authorApplication.create({
          data: {
            applicantId: userId,
            introduction: input.introduction,
            writingSample: input.writingSample,
            motivation: input.motivation,
          },
          select: {
            id: true,
            status: true,
            reviewNote: true,
            createdAt: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  getLatestApplication(userId: string) {
    return this.prisma.authorApplication.findFirst({
      where: { applicantId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        reviewNote: true,
        createdAt: true,
      },
    });
  }

  async findApplications(query: AuthorApplicationsQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.AuthorApplicationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            applicant: {
              is: {
                OR: [
                  {
                    name: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.authorApplication.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          introduction: true,
          writingSample: true,
          motivation: true,
          status: true,
          reviewNote: true,
          reviewedAt: true,
          createdAt: true,
          applicant: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.authorApplication.count({ where }),
    ]);

    return { data, meta: pageMeta(page, limit, total) };
  }

  async reviewApplication(
    reviewer: AuthUser,
    id: string,
    input: ReviewAuthorApplicationDTO,
  ) {
    const reviewedAt = new Date();
    const application = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.authorApplication.findUnique({
        where: { id },
        select: {
          id: true,
          applicantId: true,
          status: true,
          applicant: { select: { name: true, email: true } },
        },
      });
      if (!current) {
        throw new NotFoundException('Author application not found');
      }
      if (current.status !== ApprovalStatus.PENDING) {
        throw new ConflictException(
          'Only pending applications can be reviewed',
        );
      }

      const updated = await transaction.authorApplication.updateMany({
        where: { id, status: ApprovalStatus.PENDING },
        data: {
          status: input.status,
          reviewNote: input.reviewNote ?? null,
          reviewerId: reviewer.id,
          reviewedAt,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Only pending applications can be reviewed',
        );
      }

      if (input.status === ApprovalStatus.APPROVED) {
        await transaction.user.update({
          where: { id: current.applicantId },
          data: { role: UserRole.AUTHOR },
        });
        await transaction.authorProfile.create({
          data: {
            userId: current.applicantId,
            status: ApprovalStatus.APPROVED,
            isVerified: true,
          },
        });
      }

      return {
        id: current.id,
        applicantId: current.applicantId,
        applicantName: current.applicant.name,
        applicantEmail: current.applicant.email,
        status: input.status,
        reviewNote: input.reviewNote ?? null,
        reviewerId: reviewer.id,
        reviewedAt,
      };
    });

    const reviewStatus =
      input.status === ApprovalStatus.APPROVED ? 'approved' : 'rejected';
    const greeting = escapeHtml(application.applicantName);
    await this.mail.sendMail({
      to: application.applicantEmail,
      subject: `Your author application was ${reviewStatus}`,
      html: `<p>Hello ${greeting},</p><p>Your author application has been ${reviewStatus}.</p>${application.reviewNote ? `<p>Review note: ${escapeHtml(application.reviewNote)}</p>` : ''}`,
    });

    return {
      id: application.id,
      applicantId: application.applicantId,
      status: application.status,
      reviewNote: application.reviewNote,
      reviewerId: application.reviewerId,
      reviewedAt: application.reviewedAt,
    };
  }

  async getAuthorProfile(userId: string) {
    const profile = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: {
        ...authorProfileSelect,
        user: { select: { name: true, avatarUrl: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Author profile not found');
    }
    return profile;
  }

  async updateAuthorProfile(userId: string, input: UpdateAuthorProfileDTO) {
    if (
      input.bio === undefined &&
      input.facebookUrl === undefined &&
      input.instagramUrl === undefined &&
      input.websiteUrl === undefined
    ) {
      throw new BadRequestException(
        'At least one author profile field is required',
      );
    }

    const profile = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('Author profile not found');
    }

    const data: Prisma.AuthorProfileUpdateInput = {};
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.facebookUrl !== undefined) data.facebookUrl = input.facebookUrl;
    if (input.instagramUrl !== undefined)
      data.instagramUrl = input.instagramUrl;
    if (input.websiteUrl !== undefined) data.websiteUrl = input.websiteUrl;

    return this.prisma.authorProfile.update({
      where: { id: profile.id },
      data,
      select: {
        ...authorProfileSelect,
        user: { select: { name: true, avatarUrl: true } },
      },
    });
  }

  async agreeToTerms(userId: string) {
    const profile = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException('Author profile not found');
    }

    return this.prisma.authorProfile.update({
      where: { id: profile.id },
      data: { agreedToTermsAt: new Date() },
      select: { agreedToTermsAt: true },
    });
  }

  async getTermsStatus(userId: string) {
    const profile = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: { agreedToTermsAt: true },
    });
    if (!profile) {
      throw new NotFoundException('Author profile not found');
    }
    return {
      hasAgreed: profile.agreedToTermsAt !== null,
      agreedToTermsAt: profile.agreedToTermsAt,
    };
  }

  async assertTermsAgreed(userId: string): Promise<void> {
    const profile = await this.prisma.authorProfile.findUnique({
      where: { userId },
      select: { agreedToTermsAt: true },
    });
    if (!profile) {
      throw new NotFoundException('Author profile not found');
    }
    if (!profile.agreedToTermsAt) {
      throw new ForbiddenException(
        'You must agree to the author terms before submitting a manuscript',
      );
    }
  }

  getAuthorBalances(authorIds: string[]) {
    return this.royaltyService.getAuthorBalances(authorIds);
  }

  async findAuthors(query: AuthorsQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.AuthorProfileWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              {
                bio: {
                  contains: query.search,
                  mode: 'insensitive',
                },
              },
              {
                user: {
                  is: {
                    name: {
                      contains: query.search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [authors, total] = await Promise.all([
      this.prisma.authorProfile.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          bio: true,
          status: true,
          user: { select: { name: true, avatarUrl: true } },
          _count: {
            select: {
              books: { where: { status: BookStatus.PUBLISHED } },
            },
          },
        },
      }),
      this.prisma.authorProfile.count({ where }),
    ]);

    const balances = await this.getAuthorBalances(
      authors.map((author) => author.id),
    );

    return {
      data: authors.map((author) => ({
        id: author.id,
        name: author.user.name,
        avatarUrl: author.user.avatarUrl,
        bio: author.bio,
        publishedBooksCount: author._count.books,
        status: author.status,
        royalty: balances.get(author.id) ?? zeroBalance(),
      })),
      meta: pageMeta(page, limit, total),
    };
  }

  async getSummary() {
    const [totalRegisteredAuthors, pendingApplications, royaltySummary] =
      await Promise.all([
        this.prisma.user.count({ where: { role: UserRole.AUTHOR } }),
        this.prisma.authorApplication.count({
          where: { status: ApprovalStatus.PENDING },
        }),
        this.royaltyService.getSummaryMetrics(),
      ]);
    return {
      totalRegisteredAuthors,
      pendingApplications,
      pendingPayoutRequests: royaltySummary.pendingPayoutRequests,
      totalSettledRoyalties: royaltySummary.totalSettledRoyalties,
    };
  }

  async getAuthorById(id: string) {
    const author = await this.prisma.authorProfile.findUnique({
      where: { id },
      select: {
        ...authorProfileSelect,
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
        books: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            slug: true,
            status: true,
            coverImageUrl: true,
            publishedAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!author) {
      throw new NotFoundException('Author not found');
    }
    return author;
  }

  async changeAuthorStatus(id: string, status: ApprovalStatus) {
    const author = await this.prisma.authorProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!author) {
      throw new NotFoundException('Author not found');
    }

    return this.prisma.authorProfile.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  async getPublicAuthorById(id: string) {
    const author = await this.prisma.authorProfile.findFirst({
      where: { id, status: ApprovalStatus.APPROVED },
      select: {
        id: true,
        bio: true,
        facebookUrl: true,
        instagramUrl: true,
        websiteUrl: true,
        user: { select: { name: true, avatarUrl: true } },
        books: {
          where: { status: BookStatus.PUBLISHED },
          orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            slug: true,
            description: true,
            coverImageUrl: true,
            publishedAt: true,
            publishYear: true,
          },
        },
      },
    });
    if (!author) {
      throw new NotFoundException('Author not found');
    }
    return {
      id: author.id,
      name: author.user.name,
      avatarUrl: author.user.avatarUrl,
      bio: author.bio,
      facebookUrl: author.facebookUrl,
      instagramUrl: author.instagramUrl,
      websiteUrl: author.websiteUrl,
      books: author.books,
    };
  }
}
