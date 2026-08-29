import { VehicleRentalProviderName, VehicleType } from '@prisma/client';

/** DI token — inject with `@Inject(VEHICLE_RENTAL_PROVIDER)`. */
export const VEHICLE_RENTAL_PROVIDER = 'VEHICLE_RENTAL_PROVIDER';

export interface SearchVehicleRentalsCriteria {
  vehicleType: VehicleType;
  pickupCity: string;
  pickupAt: string; // ISO datetime
  dropoffAt: string;
  withDriver?: boolean;
}

export interface VehicleRentalOffer {
  id: string;
  provider: VehicleRentalProviderName;
  vehicleType: VehicleType;
  vehicleName: string;
  pickupCity: string;
  pickupAt: string;
  dropoffAt: string;
  withDriver: boolean;
  seats: number;
  currency: string;
  totalAmount: number;
  features: string[];
  expiresAt: string;
}

export interface CreateOrderResult {
  providerOrderId: string;
  status: 'CONFIRMED' | 'FAILED';
}

/**
 * Vendor-agnostic seam for car/van/bus rental search/booking — same shape
 * as HotelProviderPort/FlightProviderPort.
 */
export interface VehicleRentalProviderPort {
  searchOffers(criteria: SearchVehicleRentalsCriteria): Promise<VehicleRentalOffer[]>;
  getOffer(offerId: string): Promise<VehicleRentalOffer | null>;
  createOrder(offer: VehicleRentalOffer): Promise<CreateOrderResult>;
  cancelOrder(providerOrderId: string): Promise<void>;
}
