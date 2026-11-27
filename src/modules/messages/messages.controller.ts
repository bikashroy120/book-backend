import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { STAFF_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { MessagesQueryDTO } from './dto/messages-query.dto';
import { ReplyMessageDTO } from './dto/reply-message.dto';
import { UpdateMessageStatusDTO } from './dto/update-message-status.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
@Roles(...STAFF_ROLES)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  findAll(@Query() query: MessagesQueryDTO) {
    return this.messagesService.findAll(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.messagesService.findById(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() input: UpdateMessageStatusDTO) {
    return this.messagesService.updateStatus(id, input.status);
  }

  @Post(':id/reply')
  reply(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() input: ReplyMessageDTO,
  ) {
    return this.messagesService.reply(id, user, input);
  }
}
