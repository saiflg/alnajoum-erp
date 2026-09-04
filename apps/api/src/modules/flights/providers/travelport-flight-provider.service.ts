import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  BookingPassengerSnapshot,
  CreateOrderResult,
  FlightOffer,
  FlightProviderPort,
  IssueTicketResult,
  ProviderCapabilities,
  ProviderRefundResult,
  ReissueResult,
  SearchFlightsCriteria,
} from './flight-provider.port';

/**
 * Placeholder for a real Travelport integration
 * (https://developer.travelport.com). Credentials can already be saved for
 * it at /admin/integrations — same reasoning as Sabre/Amadeus: the
 * settings/storage layer exists ahead of the implementation, rather than
 * shipping untested API calls against a GDS with no sandbox account
 * available in this environment to verify against. Implementing this means:
 *   1. OAuth2 token — POST https://oauth.travelport.com/oauth/oauth20/token
 *   2. Air Search — POST /v1/air/search/catalog/offers over Travelport's
 *      JSON API
 *   3. Air Booking — POST /v1/air/orders
 *   4. Order cancellation/refund — POST /v1/air/orders/{id}/cancel
 * all mapped to/from the FlightProviderPort shapes. Set
 * FLIGHT_PROVIDER=travelport (or activate it at /admin/integrations) once
 * this is implemented.
 */
@Injectable()
export class TravelportFlightProviderService implements FlightProviderPort {
  private notImplemented(): never {
    throw new NotImplementedException(
      'Travelport provider is not implemented yet — credentials can be saved at /admin/integrations, but no code calls the Travelport API yet. Use Mock or Duffel instead.',
    );
  }

  capabilities(): Promise<ProviderCapabilities> {
    return Promise.resolve({ ticketing: false, refund: false, reissue: false });
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

  issueTicket(
    _providerOrderId: string,
    _offer: FlightOffer,
  ): Promise<IssueTicketResult> {
    this.notImplemented();
  }

  cancelOrder(_providerOrderId: string): Promise<void> {
    this.notImplemented();
  }

  requestRefund(
    _providerOrderId: string,
    _amount: number,
    _currency: string,
  ): Promise<ProviderRefundResult> {
    this.notImplemented();
  }

  reissue(
    _providerOrderId: string,
    _newOffer: FlightOffer,
    _passengers: BookingPassengerSnapshot[],
  ): Promise<ReissueResult> {
    this.notImplemented();
  }
}
