import { Availability, StockMovementType } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { CreateStockMovementDTO } from './dto/create-stock-movement.dto';
import { StockService } from './stock.service';

describe('StockService', () => {
  function createService(stockAfterMovement: number, updateCount = 1) {
    const transaction = {
      book: {
        updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
        findUnique:
          updateCount === 1
            ? jest.fn().mockResolvedValue({
                stock: stockAfterMovement,
                alertLimit: 5,
                availability: Availability.IN_STOCK,
              })
            : jest.fn().mockResolvedValue({ id: 'book-1' }),
        update: jest
          .fn()
          .mockImplementation(
            (input: { data: { availability: Availability } }) =>
              Promise.resolve({
                stock: stockAfterMovement,
                availability: input.data.availability,
              }),
          ),
      },
      stockMovement: {
        create: jest.fn().mockResolvedValue({ id: 'movement-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaService;
    return { service: new StockService(prisma), transaction };
  }

  it('applies outbound stock atomically and records the signed delta', async () => {
    const { service, transaction } = createService(3);

    await service.createMovement('book-1', 'staff-1', {
      type: StockMovementType.DAMAGE,
      quantity: 2,
      note: 'Damaged copies',
    });

    expect(transaction.book.updateMany).toHaveBeenCalledWith({
      where: { id: 'book-1', stock: { gte: 2 } },
      data: { stock: { decrement: 2 } },
    });
    expect(transaction.book.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: { availability: Availability.LOW_STOCK },
      select: { stock: true, availability: true },
    });
    expect(transaction.stockMovement.create).toHaveBeenCalledWith({
      data: {
        bookId: 'book-1',
        type: StockMovementType.DAMAGE,
        quantity: -2,
        balanceAfter: 3,
        note: 'Damaged copies',
        orderId: null,
        createdById: 'staff-1',
      },
    });
  });

  it('rejects outbound movement when stock is insufficient', async () => {
    const { service, transaction } = createService(0, 0);

    await expect(
      service.createMovement('book-1', 'staff-1', {
        type: StockMovementType.DAMAGE,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.stockMovement.create).not.toHaveBeenCalled();
  });

  it('requires an adjustment direction', async () => {
    const { service } = createService(2);

    await expect(
      service.createMovement('book-1', 'staff-1', {
        type: StockMovementType.ADJUSTMENT,
        quantity: 1,
      }),
    ).rejects.toThrow('direction is required');
  });

  it('does not expose SALE movements through the stock endpoint', async () => {
    const { service } = createService(2);
    const saleInput = new CreateStockMovementDTO();
    saleInput.type = StockMovementType.PURCHASE;
    Object.defineProperty(saleInput, 'type', {
      value: StockMovementType.SALE,
    });

    await expect(
      service.createMovement('book-1', 'staff-1', saleInput),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exports CSV with a UTF-8 BOM', async () => {
    const prisma = {
      book: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const file = await new StockService(prisma).exportCsv();
    const content = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = file.getStream();
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });

    expect(content.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});
