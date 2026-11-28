import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';

export type DirectUploadType = 'image' | 'pdf' | 'manuscript';

export type CloudinaryFileUpload = {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
};

type DirectUploadConfig = {
  resourceType: 'image' | 'raw';
  folder: string;
  extension: string;
  mimeTypes: Readonly<Record<string, string>>;
  maxBytes: number;
  presetName?: string;
};

type UploadTicket = {
  type: DirectUploadType;
  userId: string;
  publicId: string;
  resourceType: 'image' | 'raw';
  expiresAt: number;
};

const ticketLifetimeMs = 15 * 60 * 1000;

@Injectable()
export class CloudinaryUploadService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly directUploadConfigs: Record<
    DirectUploadType,
    DirectUploadConfig
  >;

  constructor(config: ConfigService) {
    this.cloudName = config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME');
    this.apiKey = config.getOrThrow<string>('CLOUDINARY_API_KEY');
    this.apiSecret = config.getOrThrow<string>('CLOUDINARY_API_SECRET');
    this.directUploadConfigs = {
      image: {
        resourceType: 'image',
        folder: 'hosonta/images',
        extension: '',
        mimeTypes: {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
        },
        maxBytes: 5 * 1024 * 1024,
        presetName: config.get<string>('CLOUDINARY_IMAGE_UPLOAD_PRESET'),
      },
      pdf: {
        resourceType: 'raw',
        folder: 'hosonta/files',
        extension: '.pdf',
        mimeTypes: { pdf: 'application/pdf' },
        maxBytes: 25 * 1024 * 1024,
        presetName: config.get<string>('CLOUDINARY_PDF_UPLOAD_PRESET'),
      },
      manuscript: {
        resourceType: 'raw',
        folder: 'hosonta/files',
        extension: '.pdf',
        mimeTypes: {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        maxBytes: 10 * 1024 * 1024,
        presetName: config.get<string>('CLOUDINARY_MANUSCRIPT_UPLOAD_PRESET'),
      },
    };

    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      secure: true,
    });
  }

  createDirectUploadSignature(
    type: DirectUploadType,
    userId: string,
    format?: string,
  ) {
    const config = this.directUploadConfigs[type];
    if (!config.presetName) {
      throw new ServiceUnavailableException(
        `Cloudinary ${type} upload preset is not configured`,
      );
    }

    let extension = config.extension;
    if (type === 'manuscript') {
      if (format !== 'pdf' && format !== 'docx') {
        throw new BadRequestException(
          'Manuscript upload format must be pdf or docx',
        );
      }
      extension = `.${format}`;
    } else if (format && format !== (type === 'pdf' ? 'pdf' : undefined)) {
      throw new BadRequestException('Upload format does not match the type');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `${config.folder}/${randomUUID()}${extension}`;
    const uploadParams = {
      overwrite: false,
      public_id: publicId,
      timestamp,
      upload_preset: config.presetName,
    };
    const ticket: UploadTicket = {
      type,
      userId,
      publicId,
      resourceType: config.resourceType,
      expiresAt: Date.now() + ticketLifetimeMs,
    };
    const ticketPayload = Buffer.from(JSON.stringify(ticket)).toString(
      'base64url',
    );
    const ticketSignature = this.signTicket(ticketPayload);

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/${config.resourceType}/upload`,
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      resourceType: config.resourceType,
      maxBytes: config.maxBytes,
      expiresInSeconds: ticketLifetimeMs / 1000,
      fields: {
        ...uploadParams,
        signature: cloudinary.utils.api_sign_request(
          uploadParams,
          this.apiSecret,
        ),
      },
      ticket: `${ticketPayload}.${ticketSignature}`,
    };
  }

  async confirmDirectUpload(
    ticketValue: string,
    userId: string,
  ): Promise<CloudinaryFileUpload> {
    const ticket = this.decodeTicket(ticketValue);
    if (!ticket || ticket.userId !== userId || ticket.expiresAt < Date.now()) {
      throw new BadRequestException(
        'Upload confirmation token is invalid or expired',
      );
    }

    let response: unknown;
    try {
      response = await cloudinary.api.resource(ticket.publicId, {
        resource_type: ticket.resourceType,
        type: 'upload',
      });
    } catch (error) {
      if (isRecord(error) && error.http_code === 404) {
        throw new BadRequestException(
          'Uploaded Cloudinary file was not found',
          { cause: error },
        );
      }
      throw new ServiceUnavailableException(
        'Unable to verify the Cloudinary upload',
        { cause: error },
      );
    }

    if (!isRecord(response)) {
      throw new ServiceUnavailableException(
        'Cloudinary returned an invalid asset response',
      );
    }
    const config = this.directUploadConfigs[ticket.type];
    const format = typeof response.format === 'string' ? response.format : '';
    const size = typeof response.bytes === 'number' ? response.bytes : 0;
    const secureUrl =
      typeof response.secure_url === 'string' ? response.secure_url : '';
    const publicId =
      typeof response.public_id === 'string' ? response.public_id : '';
    const resourceType =
      typeof response.resource_type === 'string' ? response.resource_type : '';
    const mimeType = config.mimeTypes[format];
    const matchesExpectedAsset =
      publicId === ticket.publicId &&
      resourceType === ticket.resourceType &&
      Boolean(mimeType) &&
      size > 0 &&
      size <= config.maxBytes &&
      Boolean(secureUrl);

    if (!matchesExpectedAsset) {
      await this.deleteDirectUpload(ticket);
      throw new BadRequestException(
        'Uploaded file does not match the allowed type or size',
      );
    }

    return {
      url: secureUrl,
      filename: publicId,
      size,
      mimeType,
    };
  }

  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<CloudinaryFileUpload> {
    const extension = extname(originalName).toLowerCase();
    const isImage = mimeType.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';
    const folder = isImage ? 'hosonta/images' : 'hosonta/files';
    const publicId = `${randomUUID()}${isImage ? '' : extension}`;
    const result = await new Promise<{
      secure_url: string;
      public_id: string;
      bytes: number;
    }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: resourceType,
          overwrite: false,
        },
        (error, uploaded) => {
          if (error || !uploaded) {
            reject(
              new ServiceUnavailableException('Cloudinary file upload failed', {
                cause: error,
              }),
            );
            return;
          }
          resolve(uploaded);
        },
      );
      uploadStream.end(buffer);
    });

    return {
      url: result.secure_url,
      filename: result.public_id,
      size: result.bytes,
      mimeType,
    };
  }

  private decodeTicket(value: string): UploadTicket | undefined {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return undefined;

    const expectedSignature = this.signTicket(payload);
    const expected = Buffer.from(expectedSignature);
    const received = Buffer.from(signature);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      );
      if (!isRecord(parsed)) return undefined;
      if (
        (parsed.type !== 'image' &&
          parsed.type !== 'pdf' &&
          parsed.type !== 'manuscript') ||
        typeof parsed.userId !== 'string' ||
        typeof parsed.publicId !== 'string' ||
        (parsed.resourceType !== 'image' && parsed.resourceType !== 'raw') ||
        typeof parsed.expiresAt !== 'number'
      ) {
        return undefined;
      }

      return {
        type: parsed.type,
        userId: parsed.userId,
        publicId: parsed.publicId,
        resourceType: parsed.resourceType,
        expiresAt: parsed.expiresAt,
      };
    } catch {
      return undefined;
    }
  }

  private async deleteDirectUpload(ticket: UploadTicket): Promise<void> {
    try {
      await cloudinary.uploader.destroy(ticket.publicId, {
        resource_type: ticket.resourceType,
        invalidate: true,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        'Unable to remove the invalid Cloudinary upload',
        { cause: error },
      );
    }
  }

  private signTicket(payload: string): string {
    return createHmac('sha256', this.apiSecret)
      .update(payload)
      .digest('base64url');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
