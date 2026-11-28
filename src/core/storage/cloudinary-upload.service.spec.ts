import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryUploadService } from './cloudinary-upload.service';

function createConfig(): ConfigService {
  return new ConfigService({
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'test-key',
    CLOUDINARY_API_SECRET: 'test-secret',
    CLOUDINARY_IMAGE_UPLOAD_PRESET: 'signed-image',
    CLOUDINARY_PDF_UPLOAD_PRESET: 'signed-pdf',
    CLOUDINARY_MANUSCRIPT_UPLOAD_PRESET: 'signed-manuscript',
  });
}

describe('CloudinaryUploadService direct uploads', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires a configured Cloudinary preset before signing uploads', () => {
    const config = new ConfigService({
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-key',
      CLOUDINARY_API_SECRET: 'test-secret',
    });
    const service = new CloudinaryUploadService(config);

    expect(() => service.createDirectUploadSignature('pdf', 'user-1')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('signs the chosen preset and confirms only the matching user asset', async () => {
    jest
      .spyOn(cloudinary.utils, 'api_sign_request')
      .mockReturnValue('cloudinary-signature');
    const resource = jest
      .spyOn(cloudinary.api, 'resource')
      .mockResolvedValue({});
    const service = new CloudinaryUploadService(createConfig());
    const signature = service.createDirectUploadSignature(
      'manuscript',
      'user-1',
      'pdf',
    );
    const uploadedPublicId = signature.fields.public_id;

    expect(signature.fields.upload_preset).toBe('signed-manuscript');
    expect(signature.fields.signature).toBe('cloudinary-signature');
    expect(signature).not.toHaveProperty('apiSecret');
    await expect(
      service.confirmDirectUpload(signature.ticket, 'user-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resource).not.toHaveBeenCalled();

    resource.mockResolvedValue({
      public_id: uploadedPublicId,
      resource_type: 'raw',
      format: 'pdf',
      bytes: 2048,
      secure_url: `https://res.cloudinary.com/test-cloud/raw/upload/${uploadedPublicId}`,
    });
    const upload = await service.confirmDirectUpload(
      signature.ticket,
      'user-1',
    );

    expect(upload).toEqual({
      url: `https://res.cloudinary.com/test-cloud/raw/upload/${uploadedPublicId}`,
      filename: uploadedPublicId,
      size: 2048,
      mimeType: 'application/pdf',
    });
  });

  it('deletes direct uploads that exceed the configured size limit', async () => {
    jest
      .spyOn(cloudinary.utils, 'api_sign_request')
      .mockReturnValue('cloudinary-signature');
    const resource = jest
      .spyOn(cloudinary.api, 'resource')
      .mockResolvedValue({});
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });
    const service = new CloudinaryUploadService(createConfig());
    const signature = service.createDirectUploadSignature('pdf', 'user-1');
    const uploadedPublicId = signature.fields.public_id;
    resource.mockResolvedValue({
      public_id: uploadedPublicId,
      resource_type: 'raw',
      format: 'pdf',
      bytes: 25 * 1024 * 1024 + 1,
      secure_url: `https://res.cloudinary.com/test-cloud/raw/upload/${uploadedPublicId}`,
    });

    await expect(
      service.confirmDirectUpload(signature.ticket, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(destroy).toHaveBeenCalledWith(
      uploadedPublicId,
      expect.objectContaining({ resource_type: 'raw' }),
    );
  });
});
