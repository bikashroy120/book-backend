import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { ContactMessageDTO } from './dto/contact-message.dto';
import { MessagesService } from './messages.service';

@Controller()
export class ContactController {
  constructor(private readonly messagesService: MessagesService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('contact')
  create(@Body() input: ContactMessageDTO) {
    return this.messagesService.createContact(input);
  }
}
