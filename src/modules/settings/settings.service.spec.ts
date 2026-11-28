import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  it('returns delivery, site, and publishing settings with defaults', async () => {
    const prisma = {
      setting: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const service = new SettingsService(prisma);

    await expect(service.getPublicSettings()).resolves.toEqual({
      delivery_charges: { insideDhaka: 60, outsideDhaka: 120 },
      site_info: { siteName: 'Hosonta Prokashon' },
      publishing_terms: {
        sections: {
          originality_copyright: '',
          content_guidelines: '',
          formatting_cover_specs: '',
          editorial_verification: '',
          pricing_royalty_payment: '',
        },
      },
    });
  });

  it('validates known setting shapes before upsert', async () => {
    const upsert = jest.fn();
    const prisma = {
      setting: { upsert },
    } as unknown as PrismaService;
    const service = new SettingsService(prisma);

    await expect(
      service.upsert('delivery_charges', {
        insideDhaka: -3,
        outsideDhaka: 120,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upsert('publishing_terms', { sections: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('normalizes and stores a valid delivery charge shape', async () => {
    const upsert = jest.fn().mockResolvedValue({ key: 'delivery_charges' });
    const prisma = {
      setting: { upsert },
    } as unknown as PrismaService;
    const service = new SettingsService(prisma);

    await service.upsert('delivery_charges', {
      insideDhaka: '60.50',
      outsideDhaka: 120,
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          key: 'delivery_charges',
          value: { insideDhaka: 60.5, outsideDhaka: 120 },
        },
      }),
    );
  });
});
