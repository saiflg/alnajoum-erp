import { CabinClass, FlightProviderName, PassengerType } from '@prisma/client';

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

export interface FlightOffer {
  id: string;
  provider: FlightProviderName;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  returnDepartureAt?: string;
  returnArrivalAt?: string;
  cabinClass: CabinClass;
  currency: string;
  totalAmount: number;
  seatsAvailable: number;
  outboundSegments: FlightSegment[];
  returnSegments?: FlightSegment[];
  /** Offers are only valid for a limited window, matching real GDS behavior. */
  expiresAt: string;
}

export interface SearchFlightsCriteria {
  origin: string;
  destination: string;
  departureDate: string; // YYYY-MM-DD
  returnDate?: string;
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
