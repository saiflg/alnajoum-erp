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
}

export interface BookingPassengerSnapshot {
  type: PassengerType;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date | null;
  passportNumber?: string | null;
}

export interface CreateOrderResult {
  providerOrderId: string;
  status: 'CONFIRMED' | 'FAILED';
}

/**
 * Vendor-agnostic seam for flight search/booking. Every real provider
 * (Duffel, Amadeus, Sabre, Travelport, ...) implements this the same way,
 * so swapping providers is a DI binding change, not a rewrite of
 * FlightsService or its controllers.
 */
export interface FlightProviderPort {
  searchOffers(criteria: SearchFlightsCriteria): Promise<FlightOffer[]>;
  getOffer(offerId: string): Promise<FlightOffer | null>;
  createOrder(
    offer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
  ): Promise<CreateOrderResult>;
  cancelOrder(providerOrderId: string): Promise<void>;
}
