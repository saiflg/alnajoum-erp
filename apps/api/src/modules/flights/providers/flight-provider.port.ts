import {
  CabinClass,
  FlightProviderName,
  PassengerType,
  TripType,
} from '@prisma/client';

/** DI token — inject with `@Inject(FLIGHT_PROVIDER)`. */
export const FLIGHT_PROVIDER = 'FLIGHT_PROVIDER';

export interface FlightSegment {
  origin: string;
  destination: string;
  departureAt: string; // ISO datetime
  arrivalAt: string;
  airline: string;
  airlineCode: string;
  flightNumber: string;
  cabinClass: CabinClass;
  durationMinutes: number;
}

/** One origin→destination hop of an itinerary (a one-way leg, one side of a
 * round trip, or one stop of a multi-city trip). Direct flights only for
 * now — no connections within a leg. */
export interface FlightLegOffer {
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  segments: FlightSegment[];
}

export interface FlightOffer {
  id: string;
  provider: FlightProviderName;
  tripType: TripType;
  /** 1 leg for ONE_WAY, 2 for ROUND_TRIP, 2-6 for MULTI_CITY. */
  legs: FlightLegOffer[];
  cabinClass: CabinClass;
  currency: string;
  totalAmount: number;
  seatsAvailable: number;
  /** Offers are only valid for a limited window, matching real GDS behavior. */
  expiresAt: string;
  /** Optional — providers that don't expose fare-rule detail through their
   * API simply omit this rather than the caller inventing one. */
  fareConditions?: FareConditions;
}

export interface FlightLegCriteria {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
}

export interface SearchFlightsCriteria {
  tripType: TripType;
  legs: FlightLegCriteria[];
  adults: number;
  children?: number;
  infants?: number;
  cabinClass?: CabinClass;
  /** Search-only filters — never sent through to createOrder. */
  directOnly?: boolean;
  currency?: string;
}

/** A fare rule / restriction / eligibility message as returned by the
 * provider — never invented locally (see FlightsService.search's doc
 * comment). `verified: false` means the provider's API doesn't expose this
 * particular condition, so the UI must say it could not be automatically
 * checked rather than staying silent about it. */
export interface FareWarning {
  message: string;
  verified: boolean;
}

/** Refundability/change-penalty/baggage detail the provider makes
 * available for an offer, shown to the customer before they book (spec
 * #4/#5) and snapshotted onto the booking so it's still visible afterwards. */
export interface FareConditions {
  refundable:
    'REFUNDABLE' | 'PARTIALLY_REFUNDABLE' | 'NON_REFUNDABLE' | 'UNKNOWN';
  changePenaltyDescription?: string;
  cancellationPenaltyDescription?: string;
  baggageAllowance?: { checked?: string; cabin?: string };
  fareBrand?: string;
  warnings: FareWarning[];
}

export interface BookingPassengerSnapshot {
  type: PassengerType;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date | null;
  passportNumber?: string | null;
}

export interface CreateOrderOptions {
  /** Only meaningful when capabilities().hold is true — creates a held
   * reservation (space confirmed, payment deferred) instead of an
   * instantly-ticketed order. A provider that doesn't support hold must
   * reject this rather than silently instant-ticketing anyway; see
   * MockFlightProviderService.createOrder for the reference behavior. */
  hold?: boolean;
}

export interface CreateOrderResult {
  providerOrderId: string;
  status: 'CONFIRMED' | 'FAILED';
  errorMessage?: string;
  /** Set only when `hold: true` was requested and honored — when this
   * expires without payment, the reservation is released by the provider.
   * FlightsService snapshots this onto FlightBooking.holdExpiresAt. */
  holdExpiresAt?: string;
}

export interface IssueTicketResult {
  pnr: string;
  /** Per-passenger ticket numbers, when the provider assigns them at
   * issuance. Omitted providers (or a provider that only returns a booking
   * reference at this stage) fall back to numbers synthesized from the PNR
   * — see FlightTicketingService.issueTicket. */
  ticketNumbers?: string[];
  status: 'TICKETED' | 'FAILED';
  errorMessage?: string;
}

export interface ProviderRefundResult {
  /** What the provider actually withheld — FlightRefundsService subtracts
   * this (and the agency's own fee) from what the customer paid; never
   * assumes the whole ticket price comes back. */
  providerPenalty: number;
  providerRefundId?: string;
  status: 'REFUNDED' | 'FAILED';
  errorMessage?: string;
}

export interface ReissueResult {
  providerOrderId: string;
  pnr: string;
  status: 'REISSUED' | 'FAILED';
  errorMessage?: string;
}

/** Only called when capabilities().void is true (spec #18). */
export interface ProviderVoidResult {
  status: 'VOIDED' | 'FAILED';
  errorMessage?: string;
}

export interface AncillaryRequest {
  type: 'BAGGAGE' | 'SEAT' | 'MEAL' | 'OTHER';
  description: string;
}

/** Only called when capabilities().ancillary is true (spec #19). */
export interface ProviderAncillaryResult {
  status: 'CONFIRMED' | 'FAILED';
  amount: number;
  currency: string;
  providerReference?: string;
  errorMessage?: string;
}

/** Which of the non-search/book operations a given provider actually
 * supports through its API today — gates FlightTicketingService/
 * FlightRefundsService/FlightReissueService so an unsupported operation is
 * shown as unavailable with a manual workflow, per spec #10/#23, instead of
 * silently failing or (worse) being implemented against undocumented
 * guesses.
 *
 * Phase 10 spec #2's "capabilities must be detectable... UI must only show
 * operations supported by the selected provider" extends this beyond
 * ticketing/refund/reissue — every field is required (not optional) so
 * each provider must explicitly declare true/false rather than an
 * unsupported operation silently defaulting to "available". search/
 * instantTicketing are true for every provider in this codebase today
 * (every provider implements searchOffers, and issueTicket always either
 * ticket-issues or throws — none has a deferred-ticketing mode yet), kept
 * as real fields anyway so a future provider that genuinely lacks one of
 * them has somewhere honest to say so. */
export interface ProviderCapabilities {
  search: boolean;
  hold: boolean;
  instantTicketing: boolean;
  ticketing: boolean;
  cancellation: boolean;
  refund: boolean;
  reissue: boolean;
  void: boolean;
  ancillary: boolean;
  seatSelection: boolean;
  baggage: boolean;
  groupBooking: boolean;
}

/**
 * Vendor-agnostic seam for flight search/booking. Every real provider
 * (Duffel, Amadeus, Sabre, Travelport, ...) implements this the same way,
 * so swapping providers is a DI binding change, not a rewrite of
 * FlightsService or its controllers.
 */
export interface FlightProviderPort {
  /** Async because FlightProviderRouter resolves which concrete provider is
   * active (a DB lookup) before it can answer this. */
  capabilities(): Promise<ProviderCapabilities>;
  searchOffers(criteria: SearchFlightsCriteria): Promise<FlightOffer[]>;
  /** Also serves as the price-revalidation call (spec #6) — callers compare
   * the freshly-fetched totalAmount against what the customer was shown at
   * search time. */
  getOffer(offerId: string): Promise<FlightOffer | null>;
  createOrder(
    offer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
    options?: CreateOrderOptions,
  ): Promise<CreateOrderResult>;
  /** Confirms/retrieves the ticket for an already-created order. For a
   * provider whose orders are instant-ticketed at creation (e.g. Duffel),
   * this is what actually fetches the PNR/ticket numbers — the booking is
   * NOT marked TICKETED until this call succeeds, keeping "booked" and
   * "ticketed" distinct in our own system regardless of provider timing. */
  issueTicket(
    providerOrderId: string,
    offer: FlightOffer,
  ): Promise<IssueTicketResult>;
  cancelOrder(providerOrderId: string): Promise<void>;
  /** Only called when capabilities().refund is true. */
  requestRefund(
    providerOrderId: string,
    amount: number,
    currency: string,
  ): Promise<ProviderRefundResult>;
  /** Only called when capabilities().reissue is true. */
  reissue(
    providerOrderId: string,
    newOffer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
  ): Promise<ReissueResult>;
  /** Only called when capabilities().void is true (spec #18). */
  requestVoid(
    providerOrderId: string,
    ticketNumbers: string[],
  ): Promise<ProviderVoidResult>;
  /** Only called when capabilities().ancillary is true (spec #19). */
  purchaseAncillary(
    providerOrderId: string,
    request: AncillaryRequest,
  ): Promise<ProviderAncillaryResult>;
}
