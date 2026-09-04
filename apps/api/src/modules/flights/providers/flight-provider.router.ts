import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../integrations/integrations.service';
import { AmadeusFlightProviderService } from './amadeus-flight-provider.service';
import { DuffelFlightProviderService } from './duffel-flight-provider.service';
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
import { MockFlightProviderService } from './mock-flight-provider.service';
import { SabreFlightProviderService } from './sabre-flight-provider.service';
import { TboFlightProviderService } from './tbo-flight-provider.service';
import { TravelportFlightProviderService } from './travelport-flight-provider.service';

/**
 * Resolves which concrete FlightProviderPort implementation handles each
 * call, checked fresh every time rather than fixed once at boot — so
 * activating a different provider at /admin/integrations takes effect on
 * the very next request, no server restart needed. Falls back to the
 * FLIGHT_PROVIDER env var when no provider has been activated through the
 * settings page yet, preserving the original deploy-time-only behavior for
 * anyone who hasn't touched the new settings UI.
 */
@Injectable()
export class FlightProviderRouter implements FlightProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly configService: ConfigService,
    private readonly mockProvider: MockFlightProviderService,
    private readonly duffelProvider: DuffelFlightProviderService,
    private readonly sabreProvider: SabreFlightProviderService,
    private readonly amadeusProvider: AmadeusFlightProviderService,
    private readonly travelportProvider: TravelportFlightProviderService,
    private readonly tboProvider: TboFlightProviderService,
  ) {}

  private async resolve(): Promise<FlightProviderPort> {
    const active = await this.integrationsService.getActiveProvider('FLIGHT');
    const providerName =
      active ?? this.configService.get<string>('FLIGHT_PROVIDER', 'mock');
    switch (providerName) {
      case 'duffel':
        return this.duffelProvider;
      case 'sabre':
        return this.sabreProvider;
      case 'amadeus':
        return this.amadeusProvider;
      case 'travelport':
        return this.travelportProvider;
      case 'tbo':
        return this.tboProvider;
      default:
        return this.mockProvider;
    }
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return (await this.resolve()).capabilities();
  }

  async searchOffers(criteria: SearchFlightsCriteria): Promise<FlightOffer[]> {
    return (await this.resolve()).searchOffers(criteria);
  }

  async getOffer(offerId: string): Promise<FlightOffer | null> {
    return (await this.resolve()).getOffer(offerId);
  }

  async createOrder(
    offer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
  ): Promise<CreateOrderResult> {
    return (await this.resolve()).createOrder(offer, passengers);
  }

  async issueTicket(
    providerOrderId: string,
    offer: FlightOffer,
  ): Promise<IssueTicketResult> {
    return (await this.resolve()).issueTicket(providerOrderId, offer);
  }

  async cancelOrder(providerOrderId: string): Promise<void> {
    return (await this.resolve()).cancelOrder(providerOrderId);
  }

  async requestRefund(
    providerOrderId: string,
    amount: number,
    currency: string,
  ): Promise<ProviderRefundResult> {
    return (await this.resolve()).requestRefund(
      providerOrderId,
      amount,
      currency,
    );
  }

  async reissue(
    providerOrderId: string,
    newOffer: FlightOffer,
    passengers: BookingPassengerSnapshot[],
  ): Promise<ReissueResult> {
    return (await this.resolve()).reissue(
      providerOrderId,
      newOffer,
      passengers,
    );
  }
}
