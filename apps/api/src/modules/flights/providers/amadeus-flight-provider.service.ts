import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  AncillaryRequest,
  BookingPassengerSnapshot,
  CreateOrderOptions,
  CreateOrderResult,
  FlightOffer,
  FlightProviderPort,
  IssueTicketResult,
  ProviderAncillaryResult,
  ProviderCapabilities,
  ProviderRefundResult,
  ProviderVoidResult,
  ReissueResult,
  SearchFlightsCriteria,
} from './flight-provider.port';

/**
 * Placeholder for a real Amadeus integration
 * (https://developers.amadeus.com). Credentials can already be saved for it
 * at /admin/integrations (API Key, API Secret) — same reasoning as
 * SabreFlightProviderService: the settings/storage layer exists ahead of
 * the implementation, rather than shipping untested API calls. Implementing
 * this means:
 *   1. OAuth2 token — POST /v1/security/oauth2/token
 *      (client_credentials grant)
 *   2. Flight Offers Search — GET /v2/shopping/flight-offers
 *   3. Flight Create Orders (booking) — POST /v1/booking/flight-orders
 *   4. Order cancellation — DELETE /v1/booking/flight-orders/{id}
 * all mapped to/from the FlightProviderPort shapes. Set
 * FLIGHT_PROVIDER=amadeus (or activate it at /admin/integrations) once this
 * is implemented.
 */
@Injectable()
export class AmadeusFlightProviderService implements FlightProviderPort {
  private notImplemented(): never {
    throw new NotImplementedException(
      'Amadeus provider is not implemented yet — credentials can be saved at /admin/integrations, but no code calls the Amadeus API yet. Use Mock or Duffel instead.',
    );
  }

  capabilities(): Promise<ProviderCapabilities> {
    return Promise.resolve({
      search: false,
      hold: false,
      instantTicketing: false,
      ticketing: false,
      cancellation: false,
      refund: false,
      reissue: false,
      void: false,
      ancillary: false,
      seatSelection: false,
      baggage: false,
      groupBooking: false,
    });
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
    _options?: CreateOrderOptions,
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

  requestVoid(
    _providerOrderId: string,
    _ticketNumbers: string[],
  ): Promise<ProviderVoidResult> {
    this.notImplemented();
  }

  purchaseAncillary(
    _providerOrderId: string,
    _request: AncillaryRequest,
  ): Promise<ProviderAncillaryResult> {
    this.notImplemented();
  }
}
