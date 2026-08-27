import { Module } from '@nestjs/common';
import { IncentivesService } from './incentives.service';

@Module({
  providers: [IncentivesService],
  exports: [IncentivesService],
})
export class IncentivesModule {}
