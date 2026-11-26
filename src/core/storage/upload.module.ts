import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { STORAGE_SERVICE } from './storage.service';
import { UploadController } from './upload.controller';

@Module({
  imports: [
    ConfigModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: diskStorage({
          destination: resolve(config.getOrThrow<string>('UPLOAD_DIR')),
          filename: (_request, file, callback) => {
            callback(null, `${randomUUID()}${extname(file.originalname)}`);
          },
        }),
      }),
    }),
  ],
  controllers: [UploadController],
  providers: [
    LocalDiskStorageService,
    { provide: STORAGE_SERVICE, useExisting: LocalDiskStorageService },
  ],
})
export class UploadModule {}
