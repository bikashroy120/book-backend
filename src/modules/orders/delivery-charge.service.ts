import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

type SettingsReader = Pick<Prisma.TransactionClient, 'setting'>;

@Injectable()
export class DeliveryChargeService {
  constructor(private readonly prisma: PrismaService) {}

  async getCharge(
    district: string,
    settingsReader: SettingsReader = this.prisma,
  ): Promise<Prisma.Decimal> {
    const isDhaka = ['dhaka', 'ঢাকা'].includes(district.trim().toLowerCase());
    const fallback = new Prisma.Decimal(isDhaka ? 60 : 120);
    const setting = await settingsReader.setting.findUnique({
      where: { key: 'delivery_charges' },
      select: { value: true },
    });
    if (!setting) return fallback;

    const value = setting.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new InternalServerErrorException(
        'The delivery_charges setting must be an object',
      );
    }

    const settings = value;
    const key = isDhaka ? 'insideDhaka' : 'outsideDhaka';
    const snakeCaseKey = isDhaka ? 'inside_dhaka' : 'outside_dhaka';
    const configured = settings[key] ?? settings[snakeCaseKey];
    if (configured === undefined) return fallback;
    if (typeof configured !== 'number' && typeof configured !== 'string') {
      throw new InternalServerErrorException(
        `The ${key} delivery charge must be a non-negative decimal`,
      );
    }

    const amount = String(configured);
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
      throw new InternalServerErrorException(
        `The ${key} delivery charge must be a non-negative decimal`,
      );
    }
    return new Prisma.Decimal(amount);
  }
}
