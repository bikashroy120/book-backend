import { MagazineStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class MagazinesQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(MagazineStatus)
  status?: MagazineStatus;
}
