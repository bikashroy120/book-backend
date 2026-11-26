import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.PORT = '3000';
process.env.FRONTEND_URL = 'http://localhost:3001';
process.env.ACCESS_TOKEN_SECRET =
  'test-access-token-secret-at-least-thirty-two-characters';
process.env.REFRESH_TOKEN_SECRET =
  'test-refresh-token-secret-at-least-thirty-two-characters';
process.env.MAIL_FROM = 'test@example.com';
process.env.UPLOAD_DIR = join(tmpdir(), `hosonta-uploads-${randomUUID()}`);
