import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppModule } from '../../src/app.module';
import { BookSchedulerService } from '../../src/modules/books/book-scheduler.service';

export default async function handler(
  request: Request,
  response: Response,
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.authorization !== `Bearer ${cronSecret}`) {
    response.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const context = await NestFactory.createApplicationContext(AppModule);
  try {
    const publishedCount = await context
      .get(BookSchedulerService)
      .publishDueBooks();
    response.status(200).json({ publishedCount });
  } finally {
    await context.close();
  }
}
