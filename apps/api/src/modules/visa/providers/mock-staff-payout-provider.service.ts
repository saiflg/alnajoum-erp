import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PayoutRequest,
  PayoutResult,
  StaffPayoutProviderPort,
} from './staff-payout-provider.port';

/**
 * Always succeeds except for one reserved sentinel account number
 * ('0000000000'), which deterministically fails with a canned provider
 * error — this is what lets tests and the demo seed exercise
 * StaffPayoutsService's FAILED/retry path without a real bank-transfer API,
 * same "sentinel value triggers the failure branch" pattern already used
 * by the mock flight/hotel providers.
 */
@Injectable()
export class MockStaffPayoutProviderService implements StaffPayoutProviderPort {
  private readonly logger = new Logger(MockStaffPayoutProviderService.name);

  sendPayout(request: PayoutRequest): Promise<PayoutResult> {
    if (request.bankAccountNumber === '0000000000') {
      this.logger.warn(
        `Mock payout failed for reference ${request.reference} (sentinel test account)`,
      );
      return Promise.resolve({
        success: false,
        errorMessage:
          'Bank rejected the transfer: account number could not be verified',
      });
    }

    this.logger.log(
      `Mock payout sent: ${request.currency} ${request.amount} to ${request.bankName} ${request.bankAccountNumber} (ref ${request.reference})`,
    );
    return Promise.resolve({
      success: true,
      providerReference: `MOCKPAY-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
  }
}
