import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  BookingPassengerSnapshot,
  CreateOrderResult,
  FlightOffer,
  FlightProviderPort,
  SearchFlightsCriteria,
} from './flight-provider.port';

/**
 * Placeholder for the real Duffel integration (https://duffel.com/docs/api).
 * Deliberately not implemented: without a sandbox API key to test against,
 * shipping "working" Duffel calls here would be untested code pretending to
 * be production-ready. Implementing this means:
 *   1. Offer Requests + Offers (search) — POST /air/offer_requests, then
 *      GET /air/offers?offer_request_id=...
 *   2. Orders (booking) — POST /air/orders
 *   3. Order cancellation — POST /air/order_cancellations
 * all mapped to/from the FlightProviderPort shapes above. Set
 * FLIGHT_PROVIDER=duffel and DUFFEL_API_KEY once ready to wire this in.
 */
@Injectable()
export class DuffelFlightProviderService implements FlightProviderPort {
  searchOffers(_criteria: SearchFlightsCriteria): Promise<FlightOffer[]> {
    throw new NotImplementedException(
      'Duffel provider is not implemented yet. Set FLIGHT_PROVIDER=mock, or implement DuffelFlightProviderService.',
    );
  }

  getOffer(_offerId: string): Promise<FlightOffer | null> {
    throw new NotImplementedException(
      'Duffel provider is not implemented yet. Set FLIGHT_PROVIDER=mock, or implement DuffelFlightProviderService.',
    );
  }

  createOrder(
    _offer: FlightOffer,
    _passengers: BookingPassengerSnapshot[],
  ): Promise<CreateOrderResult> {
    throw new NotImplementedException(
      'Duffel provider is not implemented yet. Set FLIGHT_PROVIDER=mock, or implement DuffelFlightProviderService.',
    );
  }

  cancelOrder(_providerOrderId: string): Promise<void> {
    throw new NotImplementedException(
      'Duffel provider is not implemented yet. Set FLIGHT_PROVIDER=mock, or implement DuffelFlightProviderService.',
    );
  }
}
