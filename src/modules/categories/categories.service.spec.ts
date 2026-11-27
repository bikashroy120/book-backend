import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  it('builds a multi-level tree with published book counts', async () => {
    const prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'root',
            nameBn: 'মূল',
            nameEn: 'Root',
            slug: 'root',
            parentId: null,
            _count: { books: 2 },
          },
          {
            id: 'child',
            nameBn: 'শিশু',
            nameEn: 'Child',
            slug: 'child',
            parentId: 'root',
            _count: { books: 1 },
          },
          {
            id: 'grandchild',
            nameBn: 'নাতি',
            nameEn: 'Grandchild',
            slug: 'grandchild',
            parentId: 'child',
            _count: { books: 0 },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new CategoriesService(prisma);

    const tree = await service.findTree();

    expect(tree).toHaveLength(1);
    expect(tree[0].bookCount).toBe(2);
    expect(tree[0].children[0].bookCount).toBe(1);
    expect(tree[0].children[0].children[0].id).toBe('grandchild');
  });

  it('rejects moving a category beneath its own descendant', async () => {
    const category = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'child',
        nameEn: 'Child',
        parentId: null,
      }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'root', parentId: 'child' },
        { id: 'child', parentId: null },
      ]),
      update: jest.fn(),
    };
    const transaction = { category };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CategoriesService(prisma);

    await expect(
      service.update('child', { parentId: 'root' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(category.update).not.toHaveBeenCalled();
  });

  it('uses a collision suffix for non-Latin nameEn slugs without using nameBn', async () => {
    let createdSlug: string | undefined;
    const categoryCreate = jest.fn(
      (input: {
        data: {
          nameBn: string;
          nameEn: string;
          slug: string;
          parentId: string | null;
        };
      }) => {
        createdSlug = input.data.slug;
        return Promise.resolve({
          id: 'category-2',
          ...input.data,
          createdAt: new Date(),
        });
      },
    );
    const transaction = {
      category: {
        findMany: jest.fn().mockResolvedValue([{ slug: 'category' }]),
        create: categoryCreate,
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    const service = new CategoriesService(prisma);

    await service.create({ nameBn: 'বাংলা নাম', nameEn: 'বাংলা' });

    expect(createdSlug).toBe('category-2');
  });
});
