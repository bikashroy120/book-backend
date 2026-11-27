import { UserStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class PublishersQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
