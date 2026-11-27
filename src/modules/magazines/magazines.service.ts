import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MagazineStatus, Prisma } from '@prisma/client';
import filterXSS from 'xss';
import { STAFF_ROLES } from '../../common/constants/roles';
import type { AuthUser } from '../../common/types/auth-user';
import { pageMeta, pageSkip } from '../../common/utils/pagination';
import { PrismaService } from '../../core/database/prisma.service';
import type { CreateMagazineDTO } from './dto/create-magazine.dto';
import type { MagazinesQueryDTO } from './dto/magazines-query.dto';
import type { ReviewMagazineDTO } from './dto/review-magazine.dto';
import type { UpdateMagazineDTO } from './dto/update-magazine.dto';

const magazineListSelect = {
  id: true,
  title: true,
  category: true,
  summary: true,
  coverUrl: true,
  status: true,
  reviewNote: true,
  authorId: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.MagazineSelect;

const magazineDetailSelect = {
  ...magazineListSelect,
  content: true,
} satisfies Prisma.MagazineSelect;

const publishedListSelect = {
  id: true,
  title: true,
  category: true,
  summary: true,
  coverUrl: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.MagazineSelect;

const publishedDetailSelect = {
  ...publishedListSelect,
  content: true,
} satisfies Prisma.MagazineSelect;

function sanitizedContent(content: string): string {
  const cleanContent = filterXSS(content, {
    stripIgnoreTagBody: ['script', 'style'],
  }).trim();
  if (!cleanContent) {
    throw new BadRequestException(
      'Magazine content must contain text or allowed HTML',
    );
  }
  return cleanContent;
}

@Injectable()
export class MagazinesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: MagazinesQueryDTO, user?: AuthUser) {
    if (user && STAFF_ROLES.includes(user.role)) {
      return this.findForStaff(query);
    }
    return this.findPublished(query);
  }

  async findMine(userId: string) {
    return this.prisma.magazine.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      select: magazineDetailSelect,
    });
  }

  async findPublished(query: MagazinesQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.MagazineWhereInput = {
      status: MagazineStatus.PUBLISHED,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { category: { contains: query.search, mode: 'insensitive' } },
              { summary: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.magazine.findMany({
        where,
        skip,
        take,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        select: publishedListSelect,
      }),
      this.prisma.magazine.count({ where }),
    ]);
    return { data, meta: pageMeta(page, limit, total) };
  }

  async findForStaff(query: MagazinesQueryDTO) {
    const { page, limit, skip, take } = pageSkip(query.page, query.limit);
    const where: Prisma.MagazineWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { category: { contains: query.search, mode: 'insensitive' } },
              {
                author: {
                  is: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.magazine.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: magazineDetailSelect,
      }),
      this.prisma.magazine.count({ where }),
    ]);
    return { data, meta: pageMeta(page, limit, total) };
  }

  async findPublishedById(id: string) {
    const magazine = await this.prisma.magazine.findFirst({
      where: { id, status: MagazineStatus.PUBLISHED },
      select: publishedDetailSelect,
    });
    if (!magazine) throw new NotFoundException('Magazine not found');
    return magazine;
  }

  create(userId: string, input: CreateMagazineDTO) {
    const title = input.title.trim();
    const category = input.category.trim();
    const summary = input.summary.trim();
    if (!title || !category || !summary) {
      throw new BadRequestException(
        'title, category, and summary cannot be empty',
      );
    }
    return this.prisma.magazine.create({
      data: {
        title,
        category,
        summary,
        content: sanitizedContent(input.content),
        coverUrl: input.coverUrl?.trim() || null,
        status: MagazineStatus.PENDING,
        author: { connect: { id: userId } },
      },
      select: magazineDetailSelect,
    });
  }

  async updateOwn(userId: string, id: string, input: UpdateMagazineDTO) {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one magazine field is required');
    }
    const current = await this.prisma.magazine.findUnique({
      where: { id },
      select: { id: true, authorId: true, status: true },
    });
    if (!current || current.authorId !== userId) {
      throw new NotFoundException('Magazine not found');
    }
    if (
      current.status !== MagazineStatus.PENDING &&
      current.status !== MagazineStatus.REJECTED
    ) {
      throw new ConflictException(
        'Only pending or rejected magazines can be edited',
      );
    }

    const data: Prisma.MagazineUpdateInput = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException('title cannot be empty');
      data.title = title;
    }
    if (input.category !== undefined) {
      const category = input.category.trim();
      if (!category) throw new BadRequestException('category cannot be empty');
      data.category = category;
    }
    if (input.summary !== undefined) {
      const summary = input.summary.trim();
      if (!summary) throw new BadRequestException('summary cannot be empty');
      data.summary = summary;
    }
    if (input.content !== undefined) {
      data.content = sanitizedContent(input.content);
    }
    if (input.coverUrl !== undefined) {
      data.coverUrl = input.coverUrl?.trim() || null;
    }
    if (current.status === MagazineStatus.REJECTED) {
      data.status = MagazineStatus.PENDING;
      data.reviewNote = null;
      data.publishedAt = null;
    }

    return this.prisma.magazine.update({
      where: { id },
      data,
      select: magazineDetailSelect,
    });
  }

  async removeOwn(userId: string, id: string) {
    const result = await this.prisma.magazine.deleteMany({
      where: { id, authorId: userId },
    });
    if (result.count !== 1) throw new NotFoundException('Magazine not found');
    return { id };
  }

  async review(id: string, input: ReviewMagazineDTO) {
    const current = await this.prisma.magazine.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!current) throw new NotFoundException('Magazine not found');
    if (current.status !== MagazineStatus.PENDING) {
      throw new ConflictException('Only pending magazines can be reviewed');
    }
    const published = input.status === MagazineStatus.PUBLISHED;
    return this.prisma.magazine.update({
      where: { id },
      data: {
        status: input.status,
        reviewNote: input.note?.trim() || null,
        publishedAt: published ? new Date() : null,
      },
      select: magazineListSelect,
    });
  }
}
