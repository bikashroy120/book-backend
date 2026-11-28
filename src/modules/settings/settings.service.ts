import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

const publishingSections = [
  'originality_copyright',
  'content_guidelines',
  'formatting_cover_specs',
  'editorial_verification',
  'pricing_royalty_payment',
] as const;

const defaults: Record<string, Prisma.InputJsonValue> = {
  delivery_charges: { insideDhaka: 60, outsideDhaka: 120 },
  min_withdraw: 500,
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSetting(key: string, value: unknown): Prisma.InputJsonValue {
  if (key === 'delivery_charges') {
    if (!isRecord(value)) {
      throw new BadRequestException('delivery_charges must be an object');
    }
    for (const field of ['insideDhaka', 'outsideDhaka']) {
      const charge = value[field];
      if (
        (typeof charge !== 'number' && typeof charge !== 'string') ||
        !/^\d+(?:\.\d{1,2})?$/.test(String(charge))
      ) {
        throw new BadRequestException(
          `${field} must be a non-negative amount with at most 2 decimals`,
        );
      }
    }
    return {
      insideDhaka: Number(value.insideDhaka),
      outsideDhaka: Number(value.outsideDhaka),
    };
  }

  if (key === 'min_withdraw') {
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(value))
    ) {
      throw new BadRequestException(
        'min_withdraw must be a non-negative amount with at most 2 decimals',
      );
    }
    return Number(value);
  }

  if (key === 'publishing_terms') {
    if (!isRecord(value) || !isRecord(value.sections)) {
      throw new BadRequestException(
        'publishing_terms must contain a sections object',
      );
    }
    const sections: Record<string, string> = {};
    for (const section of publishingSections) {
      const text = value.sections[section];
      if (typeof text !== 'string') {
        throw new BadRequestException(
          `publishing_terms.sections.${section} must be a string`,
        );
      }
      sections[section] = text;
    }
    return { sections };
  }

  if (key === 'site_info') {
    if (!isRecord(value)) {
      throw new BadRequestException('site_info must be an object');
    }
    for (const [field, fieldValue] of Object.entries(value)) {
      if (typeof fieldValue !== 'string') {
        throw new BadRequestException(`site_info.${field} must be a string`);
      }
    }
    return value as Prisma.InputJsonObject;
  }

  if (!isSafeJsonValue(value)) {
    throw new BadRequestException('value must be valid JSON');
  }
  return value;
}

function isSafeJsonValue(value: unknown): value is Prisma.InputJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isSafeJsonValue);
  if (isRecord(value)) {
    return Object.values(value).every(isSafeJsonValue);
  }
  return false;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicSettings() {
    const keys = ['delivery_charges', 'site_info', 'publishing_terms'] as const;
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    return Object.fromEntries(
      keys.map((key) => [key, values.get(key) ?? defaults[key]]),
    );
  }

  async getByKey(key: string) {
    const setting = await this.prisma.setting.findUnique({
      where: { key },
      select: { key: true, value: true, updatedAt: true },
    });
    if (!setting) throw new NotFoundException('Setting not found');
    return setting;
  }

  async upsert(key: string, value: unknown) {
    const validated = validateSetting(key, value);
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value: validated },
      update: { value: validated },
      select: { key: true, value: true, updatedAt: true },
    });
  }
}
