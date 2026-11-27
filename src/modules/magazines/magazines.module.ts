import { Module } from '@nestjs/common';
import { MagazinesController } from './magazines.controller';
import { MagazinesService } from './magazines.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  controllers: [MagazinesController],
  providers: [MagazinesService, OptionalAuthGuard],
})
export class MagazinesModule {}
