import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { ManualVisaProviderService } from './manual-visa-provider.service';
import { MockVisaProviderService } from './mock-visa-provider.service';
import {
  VisaProviderPort,
  VisaStatusCheckResult,
  VisaSubmissionRequest,
  VisaSubmissionResult,
} from './visa-provider.port';

/**
 * Resolves which concrete VisaProviderPort implementation handles each call,
 * checked fresh every time rather than fixed once at boot — same pattern as
 * FlightProviderRouter/HotelProviderRouter, so activating a different
 * provider at /admin/integrations takes effect on the next request with no
 * restart. Falls back to the VISA_PROVIDER env var, then to "manual" — the
 * real-world default for a business with no visa-center API today.
 */
@Injectable()
export class VisaProviderRouter implements VisaProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly manualProvider: ManualVisaProviderService,
    private readonly mockProvider: MockVisaProviderService,
  ) {}

  /** Which provider name is currently active — used by VisaSubmissionsService to record it on each VisaSubmission row. */
  async getActiveProviderName(): Promise<'manual' | 'mock'> {
    const active = await this.integrationsService.getActiveProvider('VISA');
    const providerName =
      active ?? this.configService.get<string>('VISA_PROVIDER', 'manual');
    return providerName === 'mock' ? 'mock' : 'manual';
  }

  private async resolve(): Promise<VisaProviderPort> {
    const providerName = await this.getActiveProviderName();
    return this.resolveByName(providerName);
  }

  /**
   * Resolves a specific named provider regardless of which one is
   * currently active — used by VisaSubmissionsService.syncStatus() to poll
   * the exact provider that originally received a given submission
   * (recorded on the VisaSubmission row), rather than whichever provider
   * happens to be active *now*. Without this, syncing an older submission
   * after the active provider changed at /admin/integrations would
   * silently poll the wrong provider.
   */
  resolveByName(providerName: 'manual' | 'mock'): VisaProviderPort {
    return providerName === 'mock' ? this.mockProvider : this.manualProvider;
  }

  async submitApplication(
    request: VisaSubmissionRequest,
  ): Promise<VisaSubmissionResult> {
    return (await this.resolve()).submitApplication(request);
  }

  async checkStatus(
    externalReference: string,
    previousStatus: string | null,
  ): Promise<VisaStatusCheckResult> {
    return (await this.resolve()).checkStatus(
      externalReference,
      previousStatus,
    );
  }
}
