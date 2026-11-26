export interface StorageService {
  getUploadDirectory(): string;
  getPublicUrl(filename: string): string;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
