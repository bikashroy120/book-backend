import { Global, Module } from '@nestjs/common';
import { ConsoleMailTransport } from './console-mail.transport';
import { MAIL_TRANSPORT } from './mail.types';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [
    ConsoleMailTransport,
    { provide: MAIL_TRANSPORT, useExisting: ConsoleMailTransport },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
