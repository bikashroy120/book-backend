import { IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDTO } from '../../../common/dto/pagenation.dto';

export class CreateOrderIssueDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  subject!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  details!: string;
}

export class OrderIssuesQueryDTO extends PaginationDTO {}
