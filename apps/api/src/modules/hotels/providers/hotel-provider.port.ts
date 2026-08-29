import { HotelProviderName } from '@prisma/client';

/** DI token — inject with `@Inject(HOTEL_PROVIDER)`. */
export const HOTEL_PROVIDER = 'HOTEL_PROVIDER';

export interface SearchHotelsCriteria {
  city: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string;
  rooms: number;
  guests: number;
}

export interface HotelOffer {
  id: string;
  provider: HotelProviderName;
  hotelName: string;
  city: string;
  country: string;
  starRating: number;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  guests: number;
  currency: string;
  totalAmount: number;
  amenities: string[];
  /** Offers are only valid for a limited window, matching FlightOffer. */
  expiresAt: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
  status: 'CONFIRMED' | 'FAILED';
}

/**
 * Vendor-agnostic seam for hotel search/booking — same shape as
 * FlightProviderPort, so a real provider (Booking.com's Demand API,
 * Expedia Rapid, Amadeus Hotel Search, ...) is a DI binding change, not a
 * rewrite of HotelsService or its controllers.
 */
export interface HotelProviderPort {
  searchOffers(criteria: SearchHotelsCriteria): Promise<HotelOffer[]>;
  getOffer(offerId: string): Promise<HotelOffer | null>;
  createOrder(offer: HotelOffer): Promise<CreateOrderResult>;
  cancelOrder(providerOrderId: string): Promise<void>;
}
