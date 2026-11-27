import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BookStatus, Prisma } from '@prisma/client';
import { slugify } from '../../common/utils/slug';
import { PrismaService } from '../../core/database/prisma.service';
import type { CreateCategoryDTO } from './dto/create-category.dto';
import type { UpdateCategoryDTO } from './dto/update-category.dto';

export type CategoryTreeNode = {
  id: string;
  nameBn: string;
  nameEn: string;
  slug: string;
  parentId: string | null;
  bookCount: number;
  children: CategoryTreeNode[];
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

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findTree(): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: { nameBn: 'asc' },
      select: {
        id: true,
        nameBn: true,
        nameEn: true,
        slug: true,
        parentId: true,
        _count: {
          select: { books: { where: { status: BookStatus.PUBLISHED } } },
        },
      },
    });
    const nodes: CategoryTreeNode[] = categories.map((category) => ({
      id: category.id,
      nameBn: category.nameBn,
      nameEn: category.nameEn,
      slug: category.slug,
      parentId: category.parentId,
      bookCount: category._count.books,
      children: [],
    }));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const roots: CategoryTreeNode[] = [];

    for (const node of nodes) {
      const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async create(input: CreateCategoryDTO) {
    return this.withSlugRetry(() =>
      this.prisma.$transaction(
        async (transaction) => {
          if (input.parentId) {
            const parent = await transaction.category.findUnique({
              where: { id: input.parentId },
              select: { id: true },
            });
            if (!parent) {
              throw new NotFoundException('Parent category not found');
            }
          }

          const slug = await this.uniqueSlug(transaction, input.nameEn);
          return transaction.category.create({
            data: {
              nameBn: input.nameBn,
              nameEn: input.nameEn,
              slug,
              parentId: input.parentId ?? null,
            },
            select: {
              id: true,
              nameBn: true,
              nameEn: true,
              slug: true,
              parentId: true,
              createdAt: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async update(id: string, input: UpdateCategoryDTO) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one category field is required');
    }

    return this.withSlugRetry(() =>
      this.prisma.$transaction(
        async (transaction) => {
          const current = await transaction.category.findUnique({
            where: { id },
            select: { id: true, nameEn: true, parentId: true },
          });
          if (!current) {
            throw new NotFoundException('Category not found');
          }

          if (input.parentId !== undefined) {
            await this.assertValidParent(transaction, id, input.parentId);
          }

          const nameEn = input.nameEn ?? current.nameEn;
          const slug = await this.uniqueSlug(transaction, nameEn, id);
          const data: Prisma.CategoryUncheckedUpdateInput = { slug };
          if (input.nameBn !== undefined) data.nameBn = input.nameBn;
          if (input.nameEn !== undefined) data.nameEn = input.nameEn;
          if (input.parentId !== undefined) data.parentId = input.parentId;

          return transaction.category.update({
            where: { id },
            data,
            select: {
              id: true,
              nameBn: true,
              nameEn: true,
              slug: true,
              parentId: true,
              createdAt: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async delete(id: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const category = await transaction.category.findUnique({
          where: { id },
          select: {
            id: true,
            _count: { select: { books: true, children: true } },
          },
        });
        if (!category) {
          throw new NotFoundException('Category not found');
        }
        if (category._count.books > 0 || category._count.children > 0) {
          throw new ConflictException(
            'Category has books or child categories and cannot be deleted',
          );
        }

        return transaction.category.delete({
          where: { id },
          select: { id: true },
        });
      });
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      if (isPrismaError(error, 'P2003')) {
        throw new ConflictException(
          'Category has books or child categories and cannot be deleted',
        );
      }
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Category not found');
      }
      throw error;
    }
  }

  private async assertValidParent(
    transaction: Prisma.TransactionClient,
    categoryId: string,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;

    const categories = await transaction.category.findMany({
      select: { id: true, parentId: true },
    });
    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );
    if (!categoriesById.has(parentId)) {
      throw new NotFoundException('Parent category not found');
    }

    const visited = new Set<string>();
    let currentId: string | null = parentId;
    while (currentId) {
      if (currentId === categoryId) {
        throw new ConflictException(
          'A category cannot become its own ancestor',
        );
      }
      if (visited.has(currentId)) {
        throw new ConflictException('The category tree contains a cycle');
      }
      visited.add(currentId);
      currentId = categoriesById.get(currentId)?.parentId ?? null;
    }
  }

  private async uniqueSlug(
    transaction: Prisma.TransactionClient,
    nameEn: string,
    excludeId?: string,
  ): Promise<string> {
    const categories = await transaction.category.findMany({
      where: excludeId ? { id: { not: excludeId } } : undefined,
      select: { slug: true },
    });
    const usedSlugs = new Set(categories.map((category) => category.slug));
    const baseSlug = slugify(nameEn) || 'category';
    if (!usedSlugs.has(baseSlug)) return baseSlug;

    for (let suffixNumber = 2; ; suffixNumber += 1) {
      const suffix = `-${suffixNumber}`;
      const maxBaseLength = Math.max(1, 30 - suffix.length);
      const base = slugify(nameEn, maxBaseLength) || 'category';
      const candidate = `${base.slice(0, maxBaseLength)}${suffix}`;
      if (!usedSlugs.has(candidate)) return candidate;
    }
  }

  private async withSlugRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (isPrismaError(error, 'P2002', 'P2034') && attempt < 4) continue;
        if (isPrismaError(error, 'P2002', 'P2034')) {
          throw new ConflictException(
            'Could not allocate a unique category slug; try again',
          );
        }
        if (isPrismaError(error, 'P2025')) {
          throw new NotFoundException('Category not found');
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not allocate a unique category slug; try again',
    );
  }
}
