import { MockSupplierInventoryProviderService } from './mock-supplier-inventory-provider.service';

describe('MockSupplierInventoryProviderService', () => {
  let service: MockSupplierInventoryProviderService;

  beforeEach(() => {
    service = new MockSupplierInventoryProviderService();
  });

  it('declares every capability supported', () => {
    const capabilities = service.capabilities();
    expect(Object.values(capabilities).every((v) => v === true)).toBe(true);
  });

  describe('searchAvailability', () => {
    it('reports availability by default', async () => {
      const result = await service.searchAvailability({
        productRef: 'ROOM-DELUXE',
        startDate: '2027-01-01',
        quantity: 2,
      });
      expect(result.available).toBe(true);
      expect(result.quantityAvailable).toBeGreaterThan(0);
    });

    it('reports zero availability for a SOLDOUT- productRef (spec #55)', async () => {
      const result = await service.searchAvailability({
        productRef: 'SOLDOUT-ROOM',
        startDate: '2027-01-01',
        quantity: 1,
      });
      expect(result.available).toBe(false);
      expect(result.quantityAvailable).toBe(0);
    });

    it('throws for a TIMEOUT- productRef, simulating an unreachable supplier (spec #55/#66)', async () => {
      await expect(
        service.searchAvailability({
          productRef: 'TIMEOUT-ROOM',
          startDate: '2027-01-01',
          quantity: 1,
        }),
      ).rejects.toThrow(/timeout/i);
    });
  });

  describe('retrieveRates', () => {
    it('returns a stable rate for a normal productRef', async () => {
      const result = await service.retrieveRates({
        productRef: 'ROOM-DELUXE',
        startDate: '2027-01-01',
      });
      expect(result.unitCost).toBe(50_000);
    });

    it('simulates rate mismatch for a RATEMISMATCH- productRef (spec #55/#66)', async () => {
      const first = await service.retrieveRates({
        productRef: 'RATEMISMATCH-ROOM',
        startDate: '2027-01-01',
      });
      expect(first.unitCost).toBeGreaterThanOrEqual(50_000);
    });
  });

  describe('createBooking', () => {
    it('confirms a normal booking with a supplier reference', async () => {
      const result = await service.createBooking({
        productRef: 'ROOM-DELUXE',
        startDate: '2027-01-01',
        quantity: 1,
        reference: 'OUR-REF-1',
      });
      expect(result.status).toBe('CONFIRMED');
      expect(result.supplierReference).toBeTruthy();
    });

    it('rejects a DUPLICATE- reference as FAILED rather than creating a second booking (spec #22/#66)', async () => {
      const result = await service.createBooking({
        productRef: 'ROOM-DELUXE',
        startDate: '2027-01-01',
        quantity: 1,
        reference: 'DUPLICATE-OUR-REF-1',
      });
      expect(result.status).toBe('FAILED');
      expect(result.failureReason).toContain('Duplicate');
    });

    it('throws for a TIMEOUT- productRef even on booking', async () => {
      await expect(
        service.createBooking({
          productRef: 'TIMEOUT-ROOM',
          startDate: '2027-01-01',
          quantity: 1,
          reference: 'OUR-REF-2',
        }),
      ).rejects.toThrow(/timeout/i);
    });
  });

  describe('retrieveVoucher', () => {
    it('returns a voucher number derived from the supplier reference', async () => {
      const voucher = await service.retrieveVoucher('MOCKSUP-ABC12345');
      expect(voucher.voucherNumber).toContain('MOCKSUP-ABC12345');
    });
  });
});
