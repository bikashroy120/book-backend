import { Module } from '@nestjs/common';
import { ContactController } from './contact.controller';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [ContactController, MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
