import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CabinClass, FlightProviderName, PassengerType } from '@prisma/client';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  BookingPassengerSnapshot,
  CreateOrderResult,
  FlightLegOffer,
  FlightOffer,
  FlightProviderPort,
  IssueTicketResult,
  ProviderCapabilities,
  ProviderRefundResult,
  ReissueResult,
  SearchFlightsCriteria,
} from './flight-provider.port';

const DUFFEL_CABIN: Record<CabinClass, string> = {
  ECONOMY: 'economy',
  PREMIUM_ECONOMY: 'premium_economy',
  BUSINESS: 'business',
  FIRST: 'first',
};

const DUFFEL_PASSENGER_TYPE: Record<PassengerType, string> = {
  ADULT: 'adult',
  CHILD: 'child',
  INFANT: 'infant_without_seat',
};

interface DuffelPlace {
  iata_code: string;
}

interface DuffelSegment {
  origin: DuffelPlace;
  destination: DuffelPlace;
  departing_at: string;
  arriving_at: string;
  marketing_carrier: { name: string; iata_code: string };
  marketing_carrier_flight_number: string;
  duration: string; // ISO 8601, e.g. "PT6H30M"
}

interface DuffelSlice {
  origin: DuffelPlace;
  destination: DuffelPlace;
  segments: DuffelSegment[];
}

interface DuffelOffer {
  id: string;
  slices: DuffelSlice[];
  total_amount: string;
  total_currency: string;
  expires_at: string;
}

interface DuffelOfferRequestResponse {
  data?: {
    id: string;
    offers?: DuffelOffer[];
  };
  errors?: Array<{ title: string; message: string }>;
}

interface DuffelOffersListResponse {
  data?: DuffelOffer[];
  errors?: Array<{ title: string; message: string }>;
}

interface DuffelOfferResponse {
  data?: DuffelOffer;
  errors?: Array<{ title: string; message: string }>;
}

interface DuffelOrderResponse {
  data?: { id: string };
  errors?: Array<{ title: string; message: string }>;
}

/** ISO 8601 duration like "PT6H30M" -> minutes. Falls back to 0 on anything
 * unexpected rather than throwing — a display-only field, not worth a hard
 * failure for. */
function isoDurationToMinutes(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(duration);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return hours * 60 + minutes;
}

function mapDuffelOffer(
  offer: DuffelOffer,
  cabinClass: CabinClass,
): FlightOffer {
  const legs: FlightLegOffer[] = offer.slices.map((slice) => ({
    origin: slice.origin.iata_code,
    destination: slice.destination.iata_code,
    departureAt: slice.segments[0]?.departing_at ?? '',
    arrivalAt: slice.segments[slice.segments.length - 1]?.arriving_at ?? '',
    segments: slice.segments.map((seg) => ({
      origin: seg.origin.iata_code,
      destination: seg.destination.iata_code,
      departureAt: seg.departing_at,
      arrivalAt: seg.arriving_at,
      airline: seg.marketing_carrier.name,
      airlineCode: seg.marketing_carrier.iata_code,
      flightNumber: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`,
      cabinClass,
      durationMinutes: isoDurationToMinutes(seg.duration),
    })),
  }));

  return {
    id: offer.id,
    provider: FlightProviderName.DUFFEL,
    tripType:
      legs.length === 1
        ? 'ONE_WAY'
        : legs.length === 2
          ? 'ROUND_TRIP'
          : 'MULTI_CITY',
    legs,
    cabinClass,
    currency: offer.total_currency,
    totalAmount: Number(offer.total_amount),
    // Duffel doesn't expose a simple "seats left" count on an offer the way
    // a mock/legacy GDS display does — availability is implicit in whether
    // the offer can still be ordered. 9 matches Duffel's own per-booking
    // passenger cap and is shown as an upper bound, not a literal count.
    seatsAvailable: 9,
    expiresAt: offer.expires_at,
  };
}

/**
 * Real implementation against Duffel's documented API
 * (https://duffel.com/docs/api/overview/request-signing — no request
 * signing needed, just a Bearer token) — the Offer Requests -> Offers ->
 * Orders flow:
 *   1. POST /air/offer_requests?return_offers=true — search
 *   2. GET /air/offers/:id — refetch a specific offer before booking, since
 *      prices/availability can move between search and booking
 *   3. POST /air/orders — book, paid via Duffel's test-mode balance
 *   4. POST /air/order_cancellations then its /actions/confirm — cancel
 *
 * Honesty note, same one PaystackPaymentProviderService carries: this has
 * NOT been exercised against a live Duffel account in this environment —
 * that needs a free sandbox account only the business can create
 * (duffel.com -> Sign up -> test API key, no card required). The request/
 * response shapes here are implemented per Duffel's public documentation
 * and the offer/order mapping is covered by unit tests that mock the HTTP
 * layer against realistic Duffel response bodies — but a real test-mode
 * search and booking should be run once a key is added via
 * /admin/integrations before this is trusted with real customers.
 */
@Injectable()
export class DuffelFlightProviderService implements FlightProviderPort {
  private readonly logger = new Logger(DuffelFlightProviderService.name);
  private readonly baseUrl = 'https://api.duffel.com';
  private readonly apiVersion = 'v2';

  constructor(
    private readonly configService: ConfigService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private async getApiKey(): Promise<string> {
    const dbConfig = await this.integrationsService.getCredentialConfig(
      'FLIGHT',
      'duffel',
    );
    const key =
      dbConfig?.apiKey || this.configService.get<string>('DUFFEL_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'Duffel is selected as the flight provider but no API key is configured. Add one at /admin/integrations.',
      );
    }
    return key;
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.getApiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Duffel-Version': this.apiVersion,
    };
  }

  /** Reads the configurable Timeout/Retry Policy fields saved at
   * /admin/integrations (spec #2), defaulting sanely when nothing's been
   * saved yet so an untouched install still works. */
  private async runtimeConfig(): Promise<{
    timeoutMs: number;
    retryCount: number;
  }> {
    const dbConfig = await this.integrationsService.getCredentialConfig(
      'FLIGHT',
      'duffel',
    );
    const timeoutMs = Number(dbConfig?.timeoutMs) || 15_000;
    const retryCount = Number(dbConfig?.retryCount) || 1;
    return { timeoutMs, retryCount };
  }

  /** Every Duffel call goes through here instead of raw fetch — applies the
   * configured request timeout and retries a timeout/5xx once (or as many
   * times as configured) before giving up, rather than a single fetch with
   * no time bound. */
  private async duffelFetch(url: string, init: RequestInit): Promise<Response> {
    const { timeoutMs, retryCount } = await this.runtimeConfig();
    let lastError: unknown;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timer);
        if (res.status >= 500 && attempt < retryCount) {
          this.logger.warn(
            `Duffel ${url} returned ${res.status}, retrying (attempt ${attempt + 1}/${retryCount})`,
          );
          continue;
        }
        return res;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < retryCount) {
          this.logger.warn(
            `Duffel ${url} failed (${(error as Error).message}), retrying (attempt ${attempt + 1}/${retryCount})`,
          );
          continue;
        }
      }
    }
    throw new ServiceUnavailableException(
      `The flight provider did not respond in time. ${lastError instanceof Error ? lastError.message : ''}`.trim(),
    );
  }

  capabilities(): Promise<ProviderCapabilities> {
    return Promise.resolve({
      ticketing: true,
      refund: true,
      // Duffel's real change flow (order_change_requests -> offers ->
      // order_changes) is genuinely multi-step and hasn't been implemented
      // against a live account — see this class's doc comment. Reissue is
      // deliberately marked unsupported here rather than shipping untested
      // guesses at Duffel's change-offer shape; spec #10 explicitly allows
      // this ("show the operation as unavailable... controlled manual
      // workflow").
      reissue: false,
    });
  }

  async searchOffers(criteria: SearchFlightsCriteria): Promise<FlightOffer[]> {
    const cabinClass = criteria.cabinClass ?? CabinClass.ECONOMY;
    const passengers = [
      ...Array(criteria.adults).fill({ type: 'adult' }),
      ...Array(criteria.children ?? 0).fill({ type: 'child' }),
      ...Array(criteria.infants ?? 0).fill({ type: 'infant_without_seat' }),
    ];

    const res = await this.duffelFetch(
      `${this.baseUrl}/air/offer_requests?return_offers=true`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({
          data: {
            slices: criteria.legs.map((leg) => ({
              origin: leg.origin,
              destination: leg.destination,
              departure_date: leg.departureDate,
            })),
            passengers,
            cabin_class: DUFFEL_CABIN[cabinClass],
          },
        }),
      },
    );
    const body = (await res.json()) as DuffelOfferRequestResponse;

    if (!res.ok || !body.data) {
      this.logger.error(
        `Duffel offer_request failed: ${body.errors?.[0]?.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The flight provider could not search offers right now. Please try again shortly.',
      );
    }

    // return_offers=true inlines them; fall back to a separate list call on
    // the rare chance a given account/route needs the async flow instead.
    const offers =
      body.data.offers ?? (await this.listOffersForRequest(body.data.id));

    return offers
      .map((offer) => mapDuffelOffer(offer, cabinClass))
      .sort((a, b) => a.totalAmount - b.totalAmount);
  }

  private async listOffersForRequest(
    offerRequestId: string,
  ): Promise<DuffelOffer[]> {
    const res = await this.duffelFetch(
      `${this.baseUrl}/air/offers?offer_request_id=${encodeURIComponent(offerRequestId)}`,
      { headers: await this.headers() },
    );
    const body = (await res.json()) as DuffelOffersListResponse;
    if (!res.ok || !body.data) {
      this.logger.error(
        `Duffel offers list failed: ${body.errors?.[0]?.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The flight provider could not list offers right now. Please try again shortly.',
      );
    }
    return body.data;
  }

  async getOffer(offerId: string): Promise<FlightOffer | null> {
    const res = await this.duffelFetch(
      `${this.baseUrl}/air/offers/${encodeURIComponent(offerId)}`,
      {
        headers: await this.headers(),
      },
    );
    if (res.status === 404) {
      return null;
    }
    const body = (await res.json()) as DuffelOfferResponse;
    if (!res.ok || !body.data) {
      this.logger.error(
        `Duffel get offer failed for ${offerId}: ${body.errors?.[0]?.message ?? res.statusText}`,
      );
      throw new ServiceUnavailableException(
        'The flight provider could not retrieve this offer. Please search again.',
      );
    }
    // The offer's own cabin class isn't re-derived here since Duffel
    // doesn't return it standalone on the offer object outside the
    // original search request — callers already know it from the offer
    // they searched with, matching how FlightsService.getOffer is used
    // (immediately before createOrder, with the cabin class already on
    // hand from the original search).
    return mapDuffelOffer(body.data, CabinClass.ECONOMY);
  }

  async createOrder(
    offer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
  ): Promise<CreateOrderResult> {
    const res = await this.duffelFetch(`${this.baseUrl}/air/orders`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify({
        data: {
          type: 'instant',
          selected_offers: [offer.id],
          passengers: passengers.map((p, i) => ({
            id: `pax_${i}`,
            type: DUFFEL_PASSENGER_TYPE[p.type],
            given_name: p.firstName,
            family_name: p.lastName,
            born_on: p.dateOfBirth
              ? p.dateOfBirth.toISOString().slice(0, 10)
              : undefined,
          })),
          // Duffel's test mode gives every new account a simulated balance
          // for exactly this — no real card ever touched. In live mode this
          // would need a real funding/payment method configured on the
          // Duffel account itself.
          payments: [
            {
              type: 'balance',
              currency: offer.currency,
              amount: String(offer.totalAmount),
            },
          ],
        },
      }),
    });
    const body = (await res.json()) as DuffelOrderResponse;

    if (!res.ok || !body.data) {
      this.logger.error(
        `Duffel order creation failed for offer ${offer.id}: ${body.errors?.[0]?.message ?? res.statusText}`,
      );
      return { providerOrderId: '', status: 'FAILED' };
    }

    return { providerOrderId: body.data.id, status: 'CONFIRMED' };
  }

  /** Fetches the order and pulls out its booking reference (PNR) and any
   * per-document ticket numbers — the actual "ticket confirmed" step in our
   * own state machine, even though Duffel's `type: 'instant'` orders are
   * already ticketed provider-side the moment createOrder succeeds (see the
   * FlightProviderPort doc comment on issueTicket). */
  async issueTicket(providerOrderId: string): Promise<IssueTicketResult> {
    const res = await this.duffelFetch(
      `${this.baseUrl}/air/orders/${encodeURIComponent(providerOrderId)}`,
      {
        headers: await this.headers(),
      },
    );
    const body = (await res.json()) as {
      data?: {
        booking_reference?: string;
        documents?: Array<{ unique_identifier?: string }>;
      };
      errors?: Array<{ title: string; message: string }>;
    };
    if (!res.ok || !body.data) {
      this.logger.error(
        `Duffel get order failed for ${providerOrderId}: ${body.errors?.[0]?.message ?? res.statusText}`,
      );
      return {
        pnr: '',
        status: 'FAILED',
        errorMessage: 'Could not retrieve the ticket from the provider.',
      };
    }
    const ticketNumbers = (body.data.documents ?? [])
      .map((d) => d.unique_identifier)
      .filter((v): v is string => Boolean(v));
    return {
      pnr: body.data.booking_reference ?? '',
      ticketNumbers: ticketNumbers.length > 0 ? ticketNumbers : undefined,
      status: body.data.booking_reference ? 'TICKETED' : 'FAILED',
    };
  }

  async cancelOrder(providerOrderId: string): Promise<void> {
    const result = await this.requestCancellation(providerOrderId);
    if (result.status === 'FAILED') {
      throw new ServiceUnavailableException(
        result.errorMessage ??
          'The flight provider could not cancel this order right now.',
      );
    }
  }

  async requestRefund(
    providerOrderId: string,
    amount: number,
  ): Promise<ProviderRefundResult> {
    const result = await this.requestCancellation(providerOrderId);
    if (result.status === 'FAILED') {
      return {
        providerPenalty: 0,
        status: 'FAILED',
        errorMessage: result.errorMessage,
      };
    }
    const providerPenalty = Math.max(
      0,
      amount - (result.refundAmount ?? amount),
    );
    return {
      providerPenalty,
      providerRefundId: result.cancellationId,
      status: 'REFUNDED',
    };
  }

  /** Duffel's cancellation is two-step: request a quote (which carries the
   * refund amount), then confirm it. Confirming immediately rather than
   * surfacing the quote as a separate approval step matches how the rest of
   * this app models cancellation today — the refund math itself is still
   * shown to the customer beforehand by FlightRefundsService.previewRefund,
   * which calls this same endpoint read-only-style before the real request. */
  private async requestCancellation(providerOrderId: string): Promise<{
    status: 'CONFIRMED' | 'FAILED';
    refundAmount?: number;
    cancellationId?: string;
    errorMessage?: string;
  }> {
    const createRes = await this.duffelFetch(
      `${this.baseUrl}/air/order_cancellations`,
      {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ data: { order_id: providerOrderId } }),
      },
    );
    const createBody = (await createRes.json()) as {
      data?: { id: string; refund_amount?: string };
      errors?: Array<{ title: string; message: string }>;
    };

    if (!createRes.ok || !createBody.data) {
      const message = createBody.errors?.[0]?.message ?? createRes.statusText;
      this.logger.error(
        `Duffel cancellation request failed for order ${providerOrderId}: ${message}`,
      );
      return { status: 'FAILED', errorMessage: message };
    }

    const confirmRes = await this.duffelFetch(
      `${this.baseUrl}/air/order_cancellations/${createBody.data.id}/actions/confirm`,
      { method: 'POST', headers: await this.headers() },
    );
    if (!confirmRes.ok) {
      const confirmBody = (await confirmRes.json()) as {
        errors?: Array<{ title: string; message: string }>;
      };
      const message = confirmBody.errors?.[0]?.message ?? confirmRes.statusText;
      this.logger.error(
        `Duffel cancellation confirm failed for order ${providerOrderId}: ${message}`,
      );
      return { status: 'FAILED', errorMessage: message };
    }

    return {
      status: 'CONFIRMED',
      refundAmount: createBody.data.refund_amount
        ? Number(createBody.data.refund_amount)
        : undefined,
      cancellationId: createBody.data.id,
    };
  }

  reissue(): Promise<ReissueResult> {
    return Promise.resolve({
      providerOrderId: '',
      pnr: '',
      status: 'FAILED',
      errorMessage:
        'Reissue is not available for Duffel through this integration yet — use the manual reissue workflow instead.',
    });
  }
}
