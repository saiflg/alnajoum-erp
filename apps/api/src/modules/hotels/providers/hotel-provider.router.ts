import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../../integrations/integrations.service';
import { CatalogHotelProviderService } from './catalog-hotel-provider.service';
import {
  CreateOrderResult,
  HotelOffer,
  HotelProviderPort,
  SearchHotelsCriteria,
} from './hotel-provider.port';
import { MockHotelProviderService } from './mock-hotel-provider.service';

/**
 * Unlike FlightProviderRouter (which picks exactly one active provider),
 * hotel search merges two sources every time: the admin-managed internal
 * catalog (spec #1/#4's "Manual hotel inventory") is always searched, and
 * whichever external provider is configured at /admin/integrations (mock
 * today, a real bed-bank/API later — same DI-swap pattern as
 * FlightProviderRouter) is searched alongside it. A real deployment's
 * "our own contracted hotels" and "aggregator inventory" are genuinely
 * both live sources at once, not a single switch.
 */
@Injectable()
export class HotelProviderRouter implements HotelProviderPort {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProvider: CatalogHotelProviderService,
    private readonly mockProvider: MockHotelProviderService,
  ) {}

  private async resolveExternal(): Promise<HotelProviderPort> {
    const active = await this.integrationsService.getActiveProvider('HOTEL');
    switch (active) {
      default:
        return this.mockProvider;
    }
  }

  async searchOffers(criteria: SearchHotelsCriteria): Promise<HotelOffer[]> {
    const external = await this.resolveExternal();
    const [catalogOffers, externalOffers] = await Promise.all([
      this.catalogProvider.searchOffers(criteria),
      external.searchOffers(criteria),
    ]);
    return [...catalogOffers, ...externalOffers].sort(
      (a, b) => a.totalAmount - b.totalAmount,
    );
  }

  async getOffer(offerId: string): Promise<HotelOffer | null> {
    const catalogOffer = await this.catalogProvider.getOffer(offerId);
    if (catalogOffer) return catalogOffer;
    return (await this.resolveExternal()).getOffer(offerId);
  }

  async createOrder(offer: HotelOffer): Promise<CreateOrderResult> {
    if (offer.provider === 'CATALOG') {
      return this.catalogProvider.createOrder(offer);
    }
    return (await this.resolveExternal()).createOrder(offer);
  }

  async cancelOrder(providerOrderId: string): Promise<void> {
    if (providerOrderId.startsWith('CATALOG-')) {
      return this.catalogProvider.cancelOrder(providerOrderId);
    }
    return (await this.resolveExternal()).cancelOrder(providerOrderId);
  }
}
