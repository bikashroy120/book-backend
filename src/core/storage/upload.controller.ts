import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { STORAGE_SERVICE } from './storage.service';
import type { StorageService } from './storage.service';

interface AllowedFileType {
  mimeType: string;
  extensions: readonly string[];
}

const imageTypes: readonly AllowedFileType[] = [
  { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { mimeType: 'image/png', extensions: ['.png'] },
  { mimeType: 'image/webp', extensions: ['.webp'] },
];
const pdfTypes: readonly AllowedFileType[] = [
  { mimeType: 'application/pdf', extensions: ['.pdf'] },
];
const manuscriptTypes: readonly AllowedFileType[] = [
  ...pdfTypes,
  {
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
  },
];

function createFileFilter(allowedTypes: readonly AllowedFileType[]) {
  return (
    _request: Request,
    file: Express.Multer.File,
    callback: multer.FileFilterCallback,
  ): void => {
    const extension = extname(file.originalname).toLowerCase();
    const isAllowed = allowedTypes.some(
      (type) =>
        type.mimeType === file.mimetype && type.extensions.includes(extension),
    );

    if (!isAllowed) {
      callback(null, false);
      return;
    }

    callback(null, true);
  };
}

const noExtraFields = { files: 1, fields: 0, parts: 1 };

@Controller('uploads')
export class UploadController {
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { ...noExtraFields, fileSize: 5 * 1024 * 1024 },
      fileFilter: createFileFilter(imageTypes),
    }),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    return this.toUploadResponse(file);
  }

  @Post('pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { ...noExtraFields, fileSize: 25 * 1024 * 1024 },
      fileFilter: createFileFilter(pdfTypes),
    }),
  )
  uploadPdf(@UploadedFile() file?: Express.Multer.File) {
    return this.toUploadResponse(file);
  }

  @Post('manuscript')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { ...noExtraFields, fileSize: 10 * 1024 * 1024 },
      fileFilter: createFileFilter(manuscriptTypes),
    }),
  )
  uploadManuscript(@UploadedFile() file?: Express.Multer.File) {
    return this.toUploadResponse(file);
  }

  private toUploadResponse(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'File is missing or does not match the allowed type and extension',
      );
    }

    return {
      url: this.storage.getPublicUrl(file.filename),
      filename: file.filename,
      size: file.size,
      mimeType: file.mimetype,
    };
  }
}
