/** DI token — inject with `@Inject(VISA_PROVIDER)`. */
export const VISA_PROVIDER = 'VISA_PROVIDER';

export interface VisaSubmissionRequest {
  applicationReference: string;
  destinationCountry: string;
  visaType: string;
  applicantFirstName: string;
  applicantLastName: string;
  applicantPassportNumber: string | null;
}

export interface VisaSubmissionResult {
  externalReference: string | null;
  providerStatus: string;
  message: string | null;
}

export interface VisaStatusCheckResult {
  providerStatus: string;
  message: string | null;
  /** True when the provider is asking for something before it will continue (spec #17). */
  requiresAction: boolean;
}

/**
 * Spec #15 — the application must not be tightly coupled to one visa
 * provider. Deliberately much smaller than FlightProviderPort/
 * HotelProviderPort: a visa "provider" here is either an embassy/agent
 * staff coordinate manually, or (later) a real visa-center API — there is
 * no search/offer/price-quote step the way flights and hotels have.
 */
export interface VisaProviderPort {
  submitApplication(
    request: VisaSubmissionRequest,
  ): Promise<VisaSubmissionResult>;
  /**
   * `previousStatus` is the provider's own last-known status (from the
   * VisaSubmission row) — passed in rather than tracked provider-side so
   * MockVisaProviderService can advance a deterministic state machine
   * without needing its own storage, and so a real future provider that
   * genuinely doesn't expose a status API (spec #17: "do not assume every
   * provider exposes every restriction through an API") can simply reject
   * the call instead.
   */
  checkStatus(
    externalReference: string,
    previousStatus: string | null,
  ): Promise<VisaStatusCheckResult>;
}
