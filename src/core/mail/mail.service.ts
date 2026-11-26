import { Inject, Injectable } from '@nestjs/common';
import { MAIL_TRANSPORT } from './mail.types';
import type { MailMessage, MailTransport } from './mail.types';

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  sendMail(message: MailMessage): Promise<void> {
    return this.transport.sendMail(message);
  }
}
