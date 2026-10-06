import { FlightBookingStatus, HotelBookingStatus } from '@prisma/client';
import {
  ACTIVE_FLIGHT_STATUSES,
  ACTIVE_HOTEL_STATUSES,
  CANCELLED_FLIGHT_STATUSES,
  getMetricDefinition,
  METRIC_DEFINITIONS,
  UNAVAILABLE_METRICS,
  visibleDefinitions,
} from './metric-definitions';

describe('metric definitions — one meaning per KPI', () => {
  it('has unique keys, and unavailable metrics never share a key with a live one', () => {
    const keys = METRIC_DEFINITIONS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const unavailable = UNAVAILABLE_METRICS.map((m) => m.key);
    expect(new Set(unavailable).size).toBe(unavailable.length);
    for (const k of unavailable) expect(keys).not.toContain(k);
  });

  it('every metric documents definition, calculation, date basis, source and caveats', () => {
    for (const m of METRIC_DEFINITIONS) {
      for (const field of [
        'name',
        'definition',
        'calculation',
        'dateBasis',
        'source',
      ] as const) {
        expect(m[field].length).toBeGreaterThan(5);
      }
      expect(m.caveats.length).toBeGreaterThan(0);
    }
  });

  it('a metric from a table with no branch column cannot claim to be branch-scopable', () => {
    for (const key of [
      'cash_collected',
      'receivables_outstanding',
      'supplier_payables_outstanding',
    ]) {
      expect(getMetricDefinition(key)?.branchScopable).toBe(false);
    }
  });

  it('money owed and margin are finance-audience; sales volumes are executive-audience', () => {
    expect(getMetricDefinition('gross_margin')?.audience).toBe('FINANCE');
    expect(getMetricDefinition('cash_collected')?.audience).toBe('FINANCE');
    expect(getMetricDefinition('booked_value')?.audience).toBe('EXECUTIVE');
  });

  it('visibleDefinitions hides finance metrics from a caller without the finance permission', () => {
    const exec = visibleDefinitions(false).map((m) => m.key);
    expect(exec).toContain('booked_value');
    expect(exec).not.toContain('gross_margin');
    expect(exec).not.toContain('receivables_outstanding');
    expect(visibleDefinitions(true).length).toBe(METRIC_DEFINITIONS.length);
  });

  it('an ACTIVE SALE never includes unconfirmed, failed, cancelled or refunded bookings', () => {
    for (const bad of [
      FlightBookingStatus.PENDING,
      FlightBookingStatus.FAILED,
      FlightBookingStatus.CANCELLED,
      FlightBookingStatus.REFUNDED,
    ]) {
      expect(ACTIVE_FLIGHT_STATUSES).not.toContain(bad);
    }
    for (const bad of [
      HotelBookingStatus.PENDING,
      HotelBookingStatus.CANCELLED,
      HotelBookingStatus.REFUNDED,
    ]) {
      expect(ACTIVE_HOTEL_STATUSES).not.toContain(bad);
    }
    expect(CANCELLED_FLIGHT_STATUSES).toEqual([FlightBookingStatus.CANCELLED]);
  });

  it('approximate metrics say so (cancellations use updatedAt as a proxy)', () => {
    expect(getMetricDefinition('cancellations')?.accuracy).toBe('APPROXIMATE');
  });

  it('a forecast is listed as unavailable, never as a metric', () => {
    expect(
      UNAVAILABLE_METRICS.find((m) => m.key === 'forecast')?.reason,
    ).toContain('Insufficient historical data');
    expect(getMetricDefinition('forecast')).toBeUndefined();
  });
});
