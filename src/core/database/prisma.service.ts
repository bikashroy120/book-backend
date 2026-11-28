import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configServices: ConfigService) {
    const connectionString = configServices.get<string>('DATABASE_URL');
    const configuredMax = configServices.get<number>('DATABASE_POOL_MAX');
    const pool = new Pool({
      connectionString,
      max: configuredMax ?? (process.env.VERCEL ? 1 : 10),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async onModuleInit() {
    await this.$connect();
  }
}
