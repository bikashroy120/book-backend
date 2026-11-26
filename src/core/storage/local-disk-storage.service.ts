import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StorageService } from './storage.service';

@Injectable()
export class LocalDiskStorageService implements StorageService, OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  getUploadDirectory(): string {
    return resolve(this.config.getOrThrow<string>('UPLOAD_DIR'));
  }

  getPublicUrl(filename: string): string {
    return `/uploads/${encodeURIComponent(filename)}`;
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.getUploadDirectory(), { recursive: true });
  }
}
