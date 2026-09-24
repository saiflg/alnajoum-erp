import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AvailabilityQuery,
  AvailabilityResult,
  CreateSupplierBookingInput,
  InventoryQuery,
  InventoryResult,
  RateQuery,
  RateResult,
  SupplierBookingResult,
  SupplierInventoryCapabilities,
  SupplierInventoryProviderPort,
  SupplierVoucherResult,
} from './supplier-inventory-provider.port';

/**
 * Phase 16 spec #55 — works with zero external credentials, so localhost
 * (and any deployment with no real supplier API configured yet) can
 * exercise the whole SupplierInventoryProviderPort abstraction end to end.
 * Supports every capability (a real adapter for a specific supplier would
 * likely support fewer — see the port's own doc comment on why
 * capabilities() exists).
 *
 * Deterministic simulation via magic `productRef`/`reference` prefixes,
 * same "special input triggers a specific documented outcome" convention
 * as this codebase's other mocks (e.g. DuffelFlightProviderService's test
 * fixtures) rather than random failures, so a test asserting a specific
 * behavior is reproducible:
 * - productRef starting with "SOLDOUT-" → searchAvailability reports 0 available
 * - productRef starting with "TIMEOUT-" → every operation throws (simulates
 *   a supplier that's unreachable — spec #55/#66's "timeout"/"supplier
 *   failure")
 * - reference starting with "DUPLICATE-" → createBooking returns FAILED
 *   with a duplicate-request failureReason (spec #22/#66)
 * - productRef starting with "RATEMISMATCH-" → retrieveRates returns a
 *   different unitCost each call, simulating a supplier whose price moved
 *   between search and booking (spec #55/#66's "rate mismatch")
 * Everything else succeeds with plausible, clearly-mock data.
 */
@Injectable()
export class MockSupplierInventoryProviderService implements SupplierInventoryProviderPort {
  private readonly logger = new Logger(
    MockSupplierInventoryProviderService.name,
  );

  capabilities(): SupplierInventoryCapabilities {
    return {
      searchAvailability: true,
      retrieveRates: true,
      retrieveInventory: true,
      createBooking: true,
      retrieveBooking: true,
      cancelBooking: true,
      amendBooking: true,
      retrieveVoucher: true,
    };
  }

  /** Returns a rejected promise (never throws synchronously) so every
   * caller sees this the same way regardless of whether they use
   * await/try-catch or a raw .then()/.catch() chain — a synchronous throw
   * from a Promise-returning method would only be caught by the former. */
  private timeoutRejection(productRef: string): Promise<never> | null {
    if (productRef.startsWith('TIMEOUT-')) {
      return Promise.reject(
        new Error(
          `Mock supplier: simulated timeout/unreachable for ${productRef}`,
        ),
      );
    }
    return null;
  }

  searchAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const timeout = this.timeoutRejection(query.productRef);
    if (timeout) return timeout;
    const soldOut = query.productRef.startsWith('SOLDOUT-');
    this.logger.log(
      `[mock supplier] searchAvailability ${query.productRef} x${query.quantity} — ${soldOut ? 'sold out' : 'available'}`,
    );
    return Promise.resolve({
      available: !soldOut && query.quantity <= 10,
      quantityAvailable: soldOut ? 0 : 10,
      currency: 'NGN',
      unitCost: 50_000,
    });
  }

  retrieveRates(query: RateQuery): Promise<RateResult> {
    const timeout = this.timeoutRejection(query.productRef);
    if (timeout) return timeout;
    // Simulated price drift — a real caller re-quoting right before booking
    // would see a different number than an earlier search, exactly the
    // "rate mismatch" scenario spec #55/#66 asks to be testable.
    const unitCost = query.productRef.startsWith('RATEMISMATCH-')
      ? 50_000 + Math.floor(Math.random() * 5_000)
      : 50_000;
    return Promise.resolve({
      currency: 'NGN',
      unitCost,
      cancellationPolicy: 'Free until 24h before',
    });
  }

  retrieveInventory(query: InventoryQuery): Promise<InventoryResult> {
    const timeout = this.timeoutRejection(query.productRef);
    if (timeout) return timeout;
    const totalAllocated = 20;
    const booked = 5;
    const held = 2;
    const blocked = 0;
    return Promise.resolve({
      date: query.date,
      totalAllocated,
      booked,
      held,
      blocked,
      remaining: Math.max(0, totalAllocated - booked - held - blocked),
    });
  }

  createBooking(
    input: CreateSupplierBookingInput,
  ): Promise<SupplierBookingResult> {
    const timeout = this.timeoutRejection(input.productRef);
    if (timeout) return timeout;
    if (input.reference.startsWith('DUPLICATE-')) {
      this.logger.warn(
        `[mock supplier] createBooking rejected as duplicate: ${input.reference}`,
      );
      return Promise.resolve({
        status: 'FAILED',
        failureReason:
          'Duplicate booking request — an identical reference was already processed.',
      });
    }
    const supplierReference = `MOCKSUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.logger.log(
      `[mock supplier] createBooking ${input.productRef} ref=${input.reference} -> ${supplierReference}`,
    );
    return Promise.resolve({ status: 'CONFIRMED', supplierReference });
  }

  retrieveBooking(supplierReference: string): Promise<SupplierBookingResult> {
    return Promise.resolve({ status: 'CONFIRMED', supplierReference });
  }

  cancelBooking(supplierReference: string): Promise<SupplierBookingResult> {
    this.logger.log(`[mock supplier] cancelBooking ${supplierReference}`);
    return Promise.resolve({ status: 'CONFIRMED', supplierReference });
  }

  amendBooking(
    supplierReference: string,
    input: CreateSupplierBookingInput,
  ): Promise<SupplierBookingResult> {
    const timeout = this.timeoutRejection(input.productRef);
    if (timeout) return timeout;
    this.logger.log(`[mock supplier] amendBooking ${supplierReference}`);
    return Promise.resolve({ status: 'CONFIRMED', supplierReference });
  }

  retrieveVoucher(supplierReference: string): Promise<SupplierVoucherResult> {
    return Promise.resolve({
      voucherNumber: `VCH-${supplierReference}`,
      issuedAt: new Date().toISOString(),
    });
  }
}
