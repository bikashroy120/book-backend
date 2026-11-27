import { ConflictException, NotFoundException } from '@nestjs/common';
import { MagazineStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { MagazinesService } from './magazines.service';

describe('MagazinesService', () => {
  it('sanitizes submitted HTML before persisting magazine content', async () => {
    let createData: Prisma.MagazineCreateArgs['data'] | undefined;
    const create = jest
      .fn()
      .mockImplementation(
        (args: { data: Prisma.MagazineCreateArgs['data'] }) => {
          createData = args.data;
          return Promise.resolve({ id: 'magazine-1' });
        },
      );
    const prisma = {
      magazine: { create },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await service.create('user-1', {
      title: 'Magazine',
      category: 'Stories',
      summary: 'A summary',
      content:
        '<p>Safe text</p><script>alert(1)</script><style>body{display:none}</style><img src="x" onerror="alert(1)">',
    });

    expect(createData?.content).toContain('<p>Safe text</p>');
    expect(createData?.content).not.toMatch(/script|style|onerror|alert/i);
    expect(createData?.status).toBe(MagazineStatus.PENDING);
  });

  it('returns only published magazines to public requests regardless of status filter', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      magazine: { findMany, count },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await service.findAll(
      { status: MagazineStatus.REJECTED },
      {
        id: 'reader-1',
        email: 'reader@example.test',
        role: UserRole.USER,
      },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: MagazineStatus.PUBLISHED },
      }),
    );
  });

  it('uses the requested status when a staff member lists magazines', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      magazine: { findMany, count },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await service.findAll(
      { status: MagazineStatus.REJECTED },
      {
        id: 'staff-1',
        email: 'staff@example.test',
        role: UserRole.ADMIN,
      },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: MagazineStatus.REJECTED },
      }),
    );
  });

  it('hides unpublished magazine details from public requests', async () => {
    const prisma = {
      magazine: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await expect(service.findPublishedById('draft-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resets a rejected owned magazine to pending when it is edited', async () => {
    let updateData: Prisma.MagazineUpdateInput | undefined;
    const update = jest
      .fn()
      .mockImplementation((args: { data: Prisma.MagazineUpdateInput }) => {
        updateData = args.data;
        return Promise.resolve({ id: 'magazine-1' });
      });
    const prisma = {
      magazine: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'magazine-1',
          authorId: 'user-1',
          status: MagazineStatus.REJECTED,
        }),
        update,
      },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await service.updateOwn('user-1', 'magazine-1', { title: 'Updated' });

    expect(updateData).toMatchObject({
      title: 'Updated',
      status: MagazineStatus.PENDING,
      reviewNote: null,
      publishedAt: null,
    });
  });

  it('rejects reviews for magazines that are no longer pending', async () => {
    const prisma = {
      magazine: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'magazine-1',
          status: MagazineStatus.PUBLISHED,
        }),
        update: jest.fn(),
      },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await expect(
      service.review('magazine-1', { status: MagazineStatus.REJECTED }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('publishes pending magazines and stores the review note', async () => {
    let updateData: Prisma.MagazineUpdateInput | undefined;
    const update = jest
      .fn()
      .mockImplementation((args: { data: Prisma.MagazineUpdateInput }) => {
        updateData = args.data;
        return Promise.resolve({ id: 'magazine-1' });
      });
    const prisma = {
      magazine: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'magazine-1',
          status: MagazineStatus.PENDING,
        }),
        update,
      },
    } as unknown as PrismaService;
    const service = new MagazinesService(prisma);

    await service.review('magazine-1', {
      status: MagazineStatus.PUBLISHED,
      note: 'Looks good',
    });

    expect(updateData).toMatchObject({
      status: MagazineStatus.PUBLISHED,
      reviewNote: 'Looks good',
    });
    expect(updateData?.publishedAt).toBeInstanceOf(Date);
  });
});
