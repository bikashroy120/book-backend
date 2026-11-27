import { Module } from '@nestjs/common';
import { AuthorAnalyticsController } from './royalty.controller';
import { PayoutsController } from './payouts.controller';
import { RoyaltyService } from './royalty.service';

@Module({
  controllers: [AuthorAnalyticsController, PayoutsController],
  providers: [RoyaltyService],
  exports: [RoyaltyService],
})
export class RoyaltiesModule {}
