import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  VisaProviderPort,
  VisaStatusCheckResult,
  VisaSubmissionRequest,
  VisaSubmissionResult,
} from './visa-provider.port';

/**
 * Deterministic state machine (spec #15/#36): RECEIVED -> PROCESSING ->
 * ADDITIONAL_INFO_REQUIRED -> PROCESSING -> APPROVED. Never random — a
 * demo/test run must reproduce the exact same sequence every time.
 */
const NEXT_STATUS: Record<string, string> = {
  RECEIVED: 'PROCESSING',
  PROCESSING: 'ADDITIONAL_INFO_REQUIRED',
  ADDITIONAL_INFO_REQUIRED: 'PROCESSING_2',
  PROCESSING_2: 'APPROVED',
};

const STATUS_MESSAGES: Record<string, string> = {
  RECEIVED: 'Application received by the visa center.',
  PROCESSING: 'Application is being processed.',
  ADDITIONAL_INFO_REQUIRED:
    'The visa center has requested an additional document.',
  PROCESSING_2: 'Additional document received — processing resumed.',
  APPROVED: 'Visa approved.',
};

@Injectable()
export class MockVisaProviderService implements VisaProviderPort {
  private readonly logger = new Logger(MockVisaProviderService.name);

  submitApplication(
    request: VisaSubmissionRequest,
  ): Promise<VisaSubmissionResult> {
    const externalReference = `MOCKVISA-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.logger.log(
      `Mock-submitted ${request.applicationReference} (${request.applicantFirstName} ${request.applicantLastName}) -> ${externalReference}`,
    );
    return Promise.resolve({
      externalReference,
      providerStatus: 'RECEIVED',
      message: STATUS_MESSAGES.RECEIVED,
    });
  }

  checkStatus(
    externalReference: string,
    previousStatus: string | null,
  ): Promise<VisaStatusCheckResult> {
    const current = previousStatus ?? 'RECEIVED';
    const next = NEXT_STATUS[current] ?? current; // stays put once APPROVED
    this.logger.log(
      `Mock status check ${externalReference}: ${current} -> ${next}`,
    );
    return Promise.resolve({
      providerStatus: next,
      message: STATUS_MESSAGES[next] ?? null,
      requiresAction: next === 'ADDITIONAL_INFO_REQUIRED',
    });
  }
}
