import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';

const categories = [
  { slug: 'novel', nameBn: 'উপন্যাস', nameEn: 'Novel' },
  { slug: 'self-help', nameBn: 'আত্মউন্নয়ন', nameEn: 'Self-help' },
  { slug: 'religion', nameBn: 'ধর্ম', nameEn: 'Religion' },
  { slug: 'poetry', nameBn: 'কবিতা', nameEn: 'Poetry' },
  { slug: 'history', nameBn: 'ইতিহাস', nameEn: 'History' },
  { slug: 'children', nameBn: 'শিশু-কিশোর', nameEn: 'Children' },
  { slug: 'science', nameBn: 'বিজ্ঞান', nameEn: 'Science' },
  { slug: 'biography', nameBn: 'জীবনী', nameEn: 'Biography' },
  { slug: 'education', nameBn: 'শিক্ষা', nameEn: 'Education' },
];

const settings: Array<{ key: string; value: Prisma.InputJsonValue }> = [
  {
    key: 'delivery_charges',
    value: { insideDhaka: 60, outsideDhaka: 120 },
  },
  { key: 'min_withdraw', value: 500 },
  {
    key: 'publishing_terms',
    value: {
      sections: {
        originality_copyright: '',
        content_guidelines: '',
        formatting_cover_specs: '',
        editorial_verification: '',
        pricing_royalty_payment: '',
      },
    },
  },
];

async function seed(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!connectionString || !email || !password) {
    throw new Error(
      'DATABASE_URL, SEED_ADMIN_EMAIL, and SEED_ADMIN_PASSWORD are required',
    );
  }
  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });

  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email },
      create: {
        name: 'Super Admin',
        email,
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
      },
      update: {
        password: hashedPassword,
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
      },
    });

    for (const category of categories) {
      await prisma.category.upsert({
        where: { slug: category.slug },
        create: category,
        update: {
          nameBn: category.nameBn,
          nameEn: category.nameEn,
        },
      });
    }

    for (const publisher of [
      {
        code: 'HP-PUB-001',
        nameBn: 'হোসন্তা প্রকাশন',
        nameEn: 'Hosonta Prokashon',
      },
      {
        code: 'HP-PUB-002',
        nameBn: 'নমুনা প্রকাশনী',
        nameEn: 'Sample Publications',
      },
    ]) {
      await prisma.publisher.upsert({
        where: { code: publisher.code },
        create: publisher,
        update: {
          nameBn: publisher.nameBn,
          nameEn: publisher.nameEn,
        },
      });
    }

    for (const setting of settings) {
      await prisma.setting.upsert({
        where: { key: setting.key },
        create: setting,
        update: { value: setting.value },
      });
    }

    await prisma.courier.upsert({
      where: { name: 'Default Courier' },
      create: { name: 'Default Courier', isActive: true },
      update: { isActive: true },
    });

    console.log('Database seed completed.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void seed().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Database seed failed: ${detail}`);
  process.exitCode = 1;
});
