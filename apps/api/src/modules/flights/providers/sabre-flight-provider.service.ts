import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  BookingPassengerSnapshot,
  CreateOrderResult,
  FlightOffer,
  FlightProviderPort,
  SearchFlightsCriteria,
} from './flight-provider.port';

/**
 * Placeholder for a real Sabre integration (https://developer.sabre.com).
 * Credentials can already be saved for it at /admin/integrations (Client
 * ID, Client Secret, PCC) — that storage/settings layer was built ahead of
 * the implementation itself, same reasoning DuffelFlightProviderService
 * documented before it was implemented: shipping "working" Sabre calls
 * without a sandbox account to test against would be untested code
 * pretending to be production-ready. Implementing this means:
 *   1. OAuth2 token — POST /v2/auth/token (client_credentials, Client ID +
 *      Secret base64-encoded as Basic auth)
 *   2. Bargain Finder Max (search) — POST /v4/offers/shop
 *   3. Create Passenger Name Record (booking) — POST /v2.4.0/passenger/records
 *   4. PNR cancellation — DELETE /v1/trip/orders/{id}
 * all mapped to/from the FlightProviderPort shapes FlightOffer/
 * BookingPassengerSnapshot/CreateOrderResult use. Set FLIGHT_PROVIDER=sabre
 * (or activate it at /admin/integrations) once this is implemented.
 */
@Injectable()
export class SabreFlightProviderService implements FlightProviderPort {
  private notImplemented(): never {
    throw new NotImplementedException(
      'Sabre provider is not implemented yet — credentials can be saved at /admin/integrations, but no code calls the Sabre API yet. Use Mock or Duffel instead.',
    );
  }

  searchOffers(_criteria: SearchFlightsCriteria): Promise<FlightOffer[]> {
    this.notImplemented();
  }

  getOffer(_offerId: string): Promise<FlightOffer | null> {
    this.notImplemented();
  }

  createOrder(
    _offer: FlightOffer,
    _passengers: BookingPassengerSnapshot[],
  ): Promise<CreateOrderResult> {
    this.notImplemented();
  }

  cancelOrder(_providerOrderId: string): Promise<void> {
    this.notImplemented();
  }
}
