import type { Request, Response } from 'express';
import { createApp } from '../src/app.factory';

let appPromise: ReturnType<typeof createApp> | undefined;

async function getApp() {
  if (!appPromise) {
    appPromise = createApp();
    void appPromise.catch(() => {
      appPromise = undefined;
    });
  }
  return appPromise;
}

export default async function handler(
  request: Request,
  response: Response,
): Promise<void> {
  const app = await getApp();
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp(request, response);
}
