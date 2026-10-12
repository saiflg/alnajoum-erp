import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StaffCardsService } from './staff-cards.service';

/** Once a day (06:00 Lagos time): record expiries that happened and warn administrators about the ones coming up. */
@Injectable()
export class StaffCardExpiryScheduler {
  private readonly logger = new Logger(StaffCardExpiryScheduler.name);

  constructor(private readonly cards: StaffCardsService) {}

  @Cron('0 6 * * *', { timeZone: 'Africa/Lagos' })
  async run(): Promise<void> {
    if (process.env.COMMUNICATION_SCHEDULERS_DISABLED === 'true') return;
    try {
      const r = await this.cards.sweep();
      if (r.expired || r.warned)
        this.logger.log(
          `Card sweep: ${r.expired} expired, ${r.warned} expiry warning(s) sent`,
        );
    } catch (e) {
      this.logger.error(`Card sweep failed: ${(e as Error).message}`);
    }
  }
}
