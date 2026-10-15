import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CommSenderService, TICK_SECONDS } from './comm-sender.service';

/**
 * Drives the sending queue every few seconds. Switched off by COMMUNICATION_SCHEDULERS_DISABLED=true (used by the
 * test suites), and the company-level kill switch holds everything regardless.
 */
@Injectable()
export class CommCampaignScheduler {
  private readonly logger = new Logger(CommCampaignScheduler.name);

  constructor(private readonly sender: CommSenderService) {}

  @Interval(TICK_SECONDS * 1000)
  async run(): Promise<void> {
    if (process.env.COMMUNICATION_SCHEDULERS_DISABLED === 'true') return;
    try {
      const r = await this.sender.tick();
      if (r && (r.claimed || r.started || r.completed))
        this.logger.log(
          `Queue pass: ${r.started} started, ${r.claimed} claimed (${r.sent} sent, ${r.skipped} skipped, ${r.retried} to retry, ${r.failed} failed, ${r.uncertain} uncertain), ${r.completed} finished`,
        );
    } catch (e) {
      this.logger.error(`Queue pass failed: ${(e as Error).message}`);
    }
  }
}
