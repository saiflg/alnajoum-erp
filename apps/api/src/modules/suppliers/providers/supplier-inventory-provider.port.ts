/**
 * Phase 16 spec #8/#55 — the abstraction any real supplier integration
 * (a hotel wholesaler's REST/XML API, a visa consolidator's booking
 * endpoint, an SFTP/CSV-fed static allotment, or purely manual entry)
 * would implement, mirroring how FlightProviderPort decouples Duffel from
 * booking. Only a mock implementation exists in this pass — see
 * MockSupplierInventoryProviderService and this module's own doc comment
 * for what's deliberately deferred (real REST/XML/SFTP sync jobs, rate
 * import, one mock per domain).
 *
 * Same discipline as FlightProviderPort.ProviderCapabilities: every field
 * on SupplierInventoryCapabilities is required, not optional, so a
 * provider that genuinely can't do something says so explicitly rather
 * than an unsupported operation silently defaulting to "available" or
 * throwing an opaque error. A caller must check capabilities() before
 * calling an operation; calling an unsupported one throws
 * UnsupportedCapabilityError rather than pretending to succeed.
 */
export interface SupplierInventoryCapabilities {
  searchAvailability: boolean;
  retrieveRates: boolean;
  retrieveInventory: boolean;
  createBooking: boolean;
  retrieveBooking: boolean;
  cancelBooking: boolean;
  amendBooking: boolean;
  retrieveVoucher: boolean;
}

export class UnsupportedCapabilityError extends Error {
  constructor(operation: string, providerName: string) {
    super(`${providerName} does not support ${operation}`);
    this.name = 'UnsupportedCapabilityError';
  }
}

export interface AvailabilityQuery {
  productRef: string; // supplier's own product/room-type/service code
  startDate: string; // ISO date
  endDate?: string;
  quantity: number;
}

export interface AvailabilityResult {
  available: boolean;
  quantityAvailable: number;
  currency: string;
  unitCost: number;
}

export interface RateQuery {
  productRef: string;
  startDate: string;
  endDate?: string;
}

export interface RateResult {
  currency: string;
  unitCost: number;
  cancellationPolicy?: string;
}

export interface InventoryQuery {
  productRef: string;
  date: string;
}

export interface InventoryResult {
  date: string;
  totalAllocated: number;
  booked: number;
  held: number;
  blocked: number;
  remaining: number; // totalAllocated - booked - held - blocked, never negative
}

export interface CreateSupplierBookingInput {
  productRef: string;
  startDate: string;
  endDate?: string;
  quantity: number;
  reference: string; // our own idempotency/correlation key — spec #22
  guestOrPassengerName?: string;
}

export interface SupplierBookingResult {
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
  supplierReference?: string;
  failureReason?: string;
}

export interface SupplierVoucherResult {
  voucherNumber: string;
  issuedAt: string;
}

/**
 * Vendor-agnostic seam for a single supplier's own inventory/booking
 * system. Each concrete provider (mock today; a real REST/XML/SFTP
 * adapter later) implements this.
 */
export interface SupplierInventoryProviderPort {
  capabilities(): SupplierInventoryCapabilities;
  searchAvailability(query: AvailabilityQuery): Promise<AvailabilityResult>;
  retrieveRates(query: RateQuery): Promise<RateResult>;
  retrieveInventory(query: InventoryQuery): Promise<InventoryResult>;
  createBooking(
    input: CreateSupplierBookingInput,
  ): Promise<SupplierBookingResult>;
  retrieveBooking(supplierReference: string): Promise<SupplierBookingResult>;
  cancelBooking(supplierReference: string): Promise<SupplierBookingResult>;
  amendBooking(
    supplierReference: string,
    input: CreateSupplierBookingInput,
  ): Promise<SupplierBookingResult>;
  retrieveVoucher(supplierReference: string): Promise<SupplierVoucherResult>;
}
