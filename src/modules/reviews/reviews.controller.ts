import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MODERATION_ROLES } from '../../common/constants/roles';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { CreateReviewDTO } from './dto/create-review.dto';
import { ModerateReviewDTO } from './dto/moderate-review.dto';
import { ReviewModerationQueryDTO } from './dto/moderation-query.dto';
import { MyReviewsQueryDTO } from './dto/my-reviews-query.dto';
import { PublicReviewsQueryDTO } from './dto/public-reviews-query.dto';
import { ReportReviewDTO } from './dto/report-review.dto';
import { UpdateReviewDTO } from './dto/update-review.dto';
import { ReviewsService } from './reviews.service';
import { AuthorReviewsQueryDTO } from './dto/author-reviews-query.dto';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Roles(UserRole.USER)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() input: CreateReviewDTO) {
    return this.reviewsService.create(user.id, input);
  }

  @Roles(UserRole.USER)
  @Get('me')
  findMine(@CurrentUser() user: AuthUser, @Query() query: MyReviewsQueryDTO) {
    return this.reviewsService.findMine(user.id, query);
  }

  @Roles(UserRole.USER)
  @Patch(':id')
  updateMine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateReviewDTO,
  ) {
    return this.reviewsService.updateMine(user.id, id, input);
  }

  @Roles(UserRole.USER)
  @Delete(':id')
  deleteMine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reviewsService.deleteMine(user.id, id);
  }

  @Roles(UserRole.USER)
  @Post(':id/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ReportReviewDTO,
  ) {
    return this.reviewsService.report(user.id, id, input);
  }

  @Roles(...MODERATION_ROLES)
  @Get('moderation')
  getModerationQueue(@Query() query: ReviewModerationQueryDTO) {
    return this.reviewsService.getModerationQueue(query);
  }

  @Roles(...MODERATION_ROLES)
  @Patch(':id/moderate')
  moderate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: ModerateReviewDTO,
  ) {
    return this.reviewsService.moderate(user.id, id, input);
  }

  @Roles(UserRole.AUTHOR)
  @Get('author')
  getAuthorReviews(
    @CurrentUser() user: AuthUser,
    @Query() query: AuthorReviewsQueryDTO,
  ) {
    return this.reviewsService.getAuthorReviews(user.id, query);
  }
}

@Public()
@Controller('store/books/:bookId/reviews')
export class PublicBookReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  findForBook(
    @Param('bookId') bookId: string,
    @Query() query: PublicReviewsQueryDTO,
  ) {
    return this.reviewsService.getPublicReviews(
      bookId,
      query.page,
      query.limit,
    );
  }

  @Get('summary')
  getSummary(@Param('bookId') bookId: string) {
    return this.reviewsService.getPublicSummary(bookId);
  }
}
