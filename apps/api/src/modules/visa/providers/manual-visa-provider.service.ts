import { BadRequestException, Injectable } from '@nestjs/common';
import {
  VisaProviderPort,
  VisaStatusCheckResult,
  VisaSubmissionRequest,
  VisaSubmissionResult,
} from './visa-provider.port';

/**
 * The real-world default for this business (spec #25 already treats
 * manual/offline visa processing as a first-class path) — no API exists to
 * call, so "submission" just records that the application is now in staff's
 * hands to take to the embassy/agent. Staff later log what the embassy/agent
 * says via VisaSubmissionsService.addManualProviderMessage, and advance the
 * application's own status through the existing generic status-update
 * endpoint (VisaService.updateStatus) once the embassy actually responds —
 * there is no provider status API for this service to poll.
 */
@Injectable()
export class ManualVisaProviderService implements VisaProviderPort {
  submitApplication(
    _request: VisaSubmissionRequest,
  ): Promise<VisaSubmissionResult> {
    return Promise.resolve({
      externalReference: null,
      providerStatus: 'MANUAL_PROCESSING',
      message:
        'Recorded for manual processing — update the external reference and status once the embassy/agent responds.',
    });
  }

  checkStatus(): Promise<VisaStatusCheckResult> {
    // Spec #17: "do not assume every provider exposes every restriction
    // through an API" — manual processing has none; staff record updates
    // directly instead of a sync call.
    throw new BadRequestException(
      'Manual submissions have no provider status API — record the status update directly',
    );
  }
}
