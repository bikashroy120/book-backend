import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { UploadController } from './upload.controller';
import { CloudinaryUploadService } from './cloudinary-upload.service';

@Module({
  imports: [ConfigModule],
  controllers: [UploadController],
  providers: [LocalDiskStorageService, CloudinaryUploadService],
})
export class UploadModule {}
