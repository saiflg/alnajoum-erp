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
 * Placeholder for a real TBO (Travel Boutique Online) integration
 * (https://tektravels.com — API docs shared directly with registered
 * agents, not publicly hosted). Credentials can already be saved for it at
 * /admin/integrations — same reasoning as every other unimplemented
 * provider here: no sandbox credentials are available in this environment
 * to verify a real implementation against. Implementing this means:
 *   1. Authenticate — POST /SharedAPI/SharedData.svc/rest/Authenticate
 *      (agency username/password, returns a TokenId)
 *   2. Search — POST /AirAPI_V10/AirService.svc/rest/Search
 *   3. Book — POST /AirAPI_V10/AirService.svc/rest/Book (hold) then
 *      /Ticket (issue)
 *   4. Cancel/refund — POST /AirAPI_V10/AirService.svc/rest/SendChangeRequest
 * all mapped to/from the FlightProviderPort shapes. Set
 * FLIGHT_PROVIDER=tbo (or activate it at /admin/integrations) once this is
 * implemented.
 */
@Injectable()
export class TboFlightProviderService implements FlightProviderPort {
  private notImplemented(): never {
    throw new NotImplementedException(
      'TBO provider is not implemented yet — credentials can be saved at /admin/integrations, but no code calls the TBO API yet. Use Mock or Duffel instead.',
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
