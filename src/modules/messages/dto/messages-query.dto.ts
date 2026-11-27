import { MessageStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class MessagesQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(MessageStatus)
  status?: MessageStatus;
}
