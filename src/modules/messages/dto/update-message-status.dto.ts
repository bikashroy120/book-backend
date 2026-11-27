import { MessageStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateMessageStatusDTO {
  @IsEnum(MessageStatus)
  status!: MessageStatus;
}
