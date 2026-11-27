import { BookStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { BookSchedulerService } from './book-scheduler.service';

describe('BookSchedulerService', () => {
  it('only publishes due scheduled books and reports how many changed', async () => {
    let where: Prisma.BookWhereInput | undefined;
    const updateMany = jest
      .fn()
      .mockImplementation(
        (input: {
          where: Prisma.BookWhereInput;
          data: Prisma.BookUpdateManyMutationInput;
        }) => {
          where = input.where;
          return Promise.resolve({ count: 2 });
        },
      );
    const prisma = {
      book: { updateMany },
    } as unknown as PrismaService;
    const scheduler = new BookSchedulerService(prisma);

    await expect(scheduler.publishDueBooks()).resolves.toBe(2);
    expect(where?.status).toBe(BookStatus.SCHEDULED);
    expect(where?.scheduledAt).toHaveProperty('lte');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
