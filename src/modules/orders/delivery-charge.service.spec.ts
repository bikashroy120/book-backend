import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { DeliveryChargeService } from './delivery-charge.service';

describe('DeliveryChargeService', () => {
  it('uses the fallback fee for inside and outside Dhaka when unset', async () => {
    const prisma = {
      setting: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new DeliveryChargeService(prisma);

    await expect(service.getCharge('Dhaka')).resolves.toEqual(
      new Prisma.Decimal(60),
    );
    await expect(service.getCharge('Chattogram')).resolves.toEqual(
      new Prisma.Decimal(120),
    );
  });

  it('uses configured regional charges from the delivery_charges setting', async () => {
    const prisma = {
      setting: {
        findUnique: jest.fn().mockResolvedValue({
          value: { insideDhaka: 75, outsideDhaka: '150.50' },
        }),
      },
    } as unknown as PrismaService;
    const service = new DeliveryChargeService(prisma);

    await expect(service.getCharge('ঢাকা')).resolves.toEqual(
      new Prisma.Decimal(75),
    );
    await expect(service.getCharge('Sylhet')).resolves.toEqual(
      new Prisma.Decimal('150.50'),
    );
  });

  it('surfaces malformed delivery settings instead of silently ignoring them', async () => {
    const prisma = {
      setting: {
        findUnique: jest.fn().mockResolvedValue({
          value: { insideDhaka: -1 },
        }),
      },
    } as unknown as PrismaService;
    const service = new DeliveryChargeService(prisma);

    await expect(service.getCharge('Dhaka')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
