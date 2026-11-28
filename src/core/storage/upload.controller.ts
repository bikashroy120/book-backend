import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { ConfirmDirectUploadDTO } from './dto/confirm-direct-upload.dto';
import { CreateDirectUploadSignatureDTO } from './dto/create-direct-upload-signature.dto';
import { CloudinaryUploadService } from './cloudinary-upload.service';

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
  constructor(private readonly cloudinary: CloudinaryUploadService) {}

  @Post('signature')
  createDirectUploadSignature(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateDirectUploadSignatureDTO,
  ) {
    return this.cloudinary.createDirectUploadSignature(
      input.type,
      user.id,
      input.format,
    );
  }

  @Post('confirm')
  confirmDirectUpload(
    @CurrentUser() user: AuthUser,
    @Body() input: ConfirmDirectUploadDTO,
  ) {
    return this.cloudinary.confirmDirectUpload(input.ticket, user.id);
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { ...noExtraFields, fileSize: 5 * 1024 * 1024 },
      fileFilter: createFileFilter(imageTypes),
    }),
  )
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'File is missing or does not match the allowed type and extension',
      );
    }

    return this.uploadToCloudinary(file);
  }

  @Post('pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { ...noExtraFields, fileSize: 25 * 1024 * 1024 },
      fileFilter: createFileFilter(pdfTypes),
    }),
  )
  uploadPdf(@UploadedFile() file?: Express.Multer.File) {
    return this.uploadToCloudinary(file);
  }

  @Post('manuscript')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: { ...noExtraFields, fileSize: 10 * 1024 * 1024 },
      fileFilter: createFileFilter(manuscriptTypes),
    }),
  )
  uploadManuscript(@UploadedFile() file?: Express.Multer.File) {
    return this.uploadToCloudinary(file);
  }

  private uploadToCloudinary(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'File is missing or does not match the allowed type and extension',
      );
    }

    return this.cloudinary.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }
}
