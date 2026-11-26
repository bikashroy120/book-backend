import { Injectable, Logger } from '@nestjs/common';
import type { MailMessage, MailTransport } from './mail.types';

@Injectable()
export class ConsoleMailTransport implements MailTransport {
  private readonly logger = new Logger(ConsoleMailTransport.name);

  sendMail(message: MailMessage): Promise<void> {
    this.logger.log(`Mail queued for ${message.to}: ${message.subject}`);
    return Promise.resolve();
  }
}
