import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  it('returns grouped daily sales and exports a BOM-prefixed CSV', async () => {
    const dailyRows = [
      {
        date: '2026-11-28',
        orders: 2,
        revenue: new Prisma.Decimal('250.00'),
      },
    ];
    const queryRaw = jest.fn().mockResolvedValue(dailyRows);
    const prisma = {
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    await expect(service.sales({ channel: 'WEBSITE' })).resolves.toEqual(
      dailyRows,
    );
    const csv = await service.salesCsv({});
    const content = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = csv.getStream();
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });

    expect(content.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});
