import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BookStatus,
  DeliveryStatus,
  OrderStatus,
  Prisma,
  ReviewStatus,
} from '@prisma/client';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthorReviewsQueryDTO } from './dto/author-reviews-query.dto';
import { CreateReviewDTO } from './dto/create-review.dto';
import { ModerateReviewDTO } from './dto/moderate-review.dto';
import { ReviewModerationQueryDTO } from './dto/moderation-query.dto';
import { MyReviewsQueryDTO } from './dto/my-reviews-query.dto';
import { ReportReviewDTO } from './dto/report-review.dto';
import { UpdateReviewDTO } from './dto/update-review.dto';

const reviewSelect = {
  id: true,
  rating: true,
  title: true,
  comment: true,
  status: true,
  isVerifiedPurchase: true,
  reportCount: true,
  moderationNote: true,
  moderatedAt: true,
  createdAt: true,
  updatedAt: true,
  book: {
    select: {
      id: true,
      title: true,
      slug: true,
      coverImageUrl: true,
      authorName: true,
    },
  },
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ReviewSelect;

type RatingDistribution = Record<5 | 4 | 3 | 2 | 1, number>;

function emptyDistribution(): RatingDistribution {
  return { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function tabStatus(
  tab: MyReviewsQueryDTO['tab'],
): Prisma.ReviewWhereInput | undefined {
  switch (tab) {
    case 'pending':
      return { status: ReviewStatus.PENDING };
    case 'published':
      return { status: ReviewStatus.APPROVED };
    case 'rejected':
      return { status: ReviewStatus.REJECTED };
    case 'hidden':
      return { status: ReviewStatus.CLOSED };
    default:
      return undefined;
  }
}

function moderationTabStatus(
  tab: ReviewModerationQueryDTO['tab'],
): Prisma.ReviewWhereInput | undefined {
  switch (tab) {
    case 'pending':
      return { status: ReviewStatus.PENDING };
    case 'reported':
      return { status: ReviewStatus.REPORTED };
    case 'approved':
      return { status: ReviewStatus.APPROVED };
    case 'closed':
      return {
        status: { in: [ReviewStatus.CLOSED, ReviewStatus.REJECTED] },
      };
    default:
      return undefined;
  }
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateReviewDTO) {
    const book = await this.prisma.book.findUnique({
      where: { id: input.bookId },
      select: { id: true },
    });
    if (!book) throw new NotFoundException('Book not found');

    const qualifyingOrderItem = await this.prisma.orderItem.findFirst({
      where: {
        bookId: book.id,
        order: {
          is: {
            customerId: userId,
            OR: [
              { status: OrderStatus.COMPLETED },
              { deliveryStatus: DeliveryStatus.DELIVERED },
            ],
          },
        },
      },
      select: { id: true },
    });
    if (!qualifyingOrderItem) {
      throw new ForbiddenException(
        'A delivered or completed order containing this book is required to review it',
      );
    }

    try {
      return await this.prisma.review.create({
        data: {
          bookId: book.id,
          userId,
          rating: input.rating,
          title: input.title,
          comment: input.comment,
          status: ReviewStatus.PENDING,
          isVerifiedPurchase: true,
        },
        select: reviewSelect,
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        throw new ConflictException('You have already reviewed this book');
      }
      throw error;
    }
  }

  async findMine(userId: string, query: MyReviewsQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const baseWhere: Prisma.ReviewWhereInput = {
      userId,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { comment: { contains: query.search, mode: 'insensitive' } },
              {
                book: {
                  is: {
                    title: {
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
    const selectedWhere: Prisma.ReviewWhereInput = {
      ...baseWhere,
      ...tabStatus(query.tab),
    };
    const [reviews, total, statusGroups] = await Promise.all([
      this.prisma.review.findMany({
        where: selectedWhere,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        select: reviewSelect,
      }),
      this.prisma.review.count({ where: selectedWhere }),
      this.prisma.review.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(
      statusGroups.map((group) => [group.status, group._count._all]),
    );
    return {
      data: reviews,
      meta: {
        ...pageMeta(page, limit, total),
        counts: {
          all: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
          pending: counts.get(ReviewStatus.PENDING) ?? 0,
          published: counts.get(ReviewStatus.APPROVED) ?? 0,
          rejected: counts.get(ReviewStatus.REJECTED) ?? 0,
          hidden: counts.get(ReviewStatus.CLOSED) ?? 0,
        },
      },
    };
  }

  async updateMine(userId: string, reviewId: string, input: UpdateReviewDTO) {
    if (
      input.rating === undefined &&
      input.title === undefined &&
      input.comment === undefined
    ) {
      throw new BadRequestException(
        'At least one review field must be updated',
      );
    }
    const current = await this.prisma.review.findFirst({
      where: { id: reviewId, userId },
      select: { id: true },
    });
    if (!current) throw new NotFoundException('Review not found');

    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(input.rating !== undefined ? { rating: input.rating } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
        status: ReviewStatus.PENDING,
        moderatorId: null,
        moderatedAt: null,
        moderationNote: null,
      },
      select: reviewSelect,
    });
  }

  async deleteMine(userId: string, reviewId: string) {
    const result = await this.prisma.review.deleteMany({
      where: { id: reviewId, userId },
    });
    if (result.count !== 1) throw new NotFoundException('Review not found');
    return { deleted: true };
  }

  async getPublicReviews(
    bookId: string,
    pageInput?: number,
    limitInput?: number,
  ) {
    await this.requirePublishedBook(bookId);
    const { page, limit, skip, take } = pageSkip(pageInput, limitInput);
    const where: Prisma.ReviewWhereInput = {
      bookId,
      status: ReviewStatus.APPROVED,
    };
    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          isVerifiedPurchase: true,
          createdAt: true,
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);
    return { data: reviews, meta: pageMeta(page, limit, total) };
  }

  async getPublicSummary(bookId: string) {
    await this.requirePublishedBook(bookId);
    const where = { bookId, status: ReviewStatus.APPROVED };
    const [aggregate, groups] = await Promise.all([
      this.prisma.review.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where,
        _count: { _all: true },
      }),
    ]);
    const distribution = emptyDistribution();
    for (const group of groups) {
      distribution[group.rating as keyof RatingDistribution] =
        group._count._all;
    }
    return {
      average: aggregate._avg.rating ?? 0,
      count: aggregate._count._all,
      distribution,
    };
  }

  async getModerationQueue(query: ReviewModerationQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const baseWhere: Prisma.ReviewWhereInput = {
      ...(query.rating !== undefined ? { rating: query.rating } : {}),
      ...(query.search
        ? {
            OR: [
              { comment: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              {
                book: {
                  is: {
                    title: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              {
                user: {
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
              },
            ],
          }
        : {}),
    };
    const where: Prisma.ReviewWhereInput = {
      ...baseWhere,
      ...moderationTabStatus(query.tab),
    };
    const [reviews, total, statusGroups] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: [{ reportCount: 'desc' }, { createdAt: 'asc' }],
        select: reviewSelect,
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({
        by: ['status'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(
      statusGroups.map((group) => [group.status, group._count._all]),
    );
    return {
      data: reviews,
      meta: {
        ...pageMeta(page, limit, total),
        counts: {
          pending: counts.get(ReviewStatus.PENDING) ?? 0,
          reported: counts.get(ReviewStatus.REPORTED) ?? 0,
          approved: counts.get(ReviewStatus.APPROVED) ?? 0,
          closed:
            (counts.get(ReviewStatus.CLOSED) ?? 0) +
            (counts.get(ReviewStatus.REJECTED) ?? 0),
        },
      },
    };
  }

  async moderate(
    moderatorId: string,
    reviewId: string,
    input: ModerateReviewDTO,
  ) {
    const exists = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Review not found');
    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        status: input.status,
        moderationNote: input.note ?? null,
        moderatorId,
        moderatedAt: new Date(),
      },
      select: reviewSelect,
    });
  }

  async report(userId: string, reviewId: string, input: ReportReviewDTO) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const review = await transaction.review.findUnique({
          where: { id: reviewId },
          select: { id: true, userId: true, status: true },
        });
        if (!review) throw new NotFoundException('Review not found');
        if (review.userId === userId) {
          throw new ForbiddenException('You cannot report your own review');
        }
        if (
          review.status !== ReviewStatus.APPROVED &&
          review.status !== ReviewStatus.REPORTED
        ) {
          throw new ConflictException('Only published reviews can be reported');
        }

        await transaction.reviewReport.create({
          data: { reviewId, reporterId: userId, reason: input.reason },
          select: { id: true },
        });
        const updated = await transaction.review.updateMany({
          where: {
            id: reviewId,
            status: { in: [ReviewStatus.APPROVED, ReviewStatus.REPORTED] },
          },
          data: {
            status: ReviewStatus.REPORTED,
            reportCount: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'The review status changed; refresh and try again',
          );
        }
        return { reported: true };
      });
    } catch (error) {
      if (isPrismaCode(error, 'P2002')) {
        throw new ConflictException('You have already reported this review');
      }
      throw error;
    }
  }

  async getAuthorReviews(authorUserId: string, query: AuthorReviewsQueryDTO) {
    const author = await this.prisma.authorProfile.findUnique({
      where: { userId: authorUserId },
      select: { id: true },
    });
    if (!author) throw new NotFoundException('Author profile not found');

    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.ReviewWhereInput = {
      status: ReviewStatus.APPROVED,
      book: { is: { authorId: author.id } },
      ...(query.bookId ? { bookId: query.bookId } : {}),
      ...(query.rating !== undefined ? { rating: query.rating } : {}),
    };
    const [reviews, total, aggregate, groups] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          isVerifiedPurchase: true,
          createdAt: true,
          book: {
            select: { id: true, title: true, slug: true, coverImageUrl: true },
          },
          user: { select: { id: true, name: true, avatarUrl: true } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where,
        _count: { _all: true },
      }),
    ]);
    const distribution = emptyDistribution();
    let positiveCount = 0;
    for (const group of groups) {
      distribution[group.rating as keyof RatingDistribution] =
        group._count._all;
      if (group.rating >= 4) positiveCount += group._count._all;
    }
    const approvedCount = aggregate._count._all;

    return {
      data: reviews,
      meta: {
        ...pageMeta(page, limit, total),
        stats: {
          average: aggregate._avg.rating ?? 0,
          approvedCount,
          positivePercent:
            approvedCount === 0
              ? 0
              : Math.round((positiveCount / approvedCount) * 10000) / 100,
          distribution,
        },
      },
    };
  }

  private async requirePublishedBook(bookId: string) {
    const book = await this.prisma.book.findFirst({
      where: { id: bookId, status: BookStatus.PUBLISHED },
      select: { id: true },
    });
    if (!book) throw new NotFoundException('Book not found');
    return book;
  }
}
