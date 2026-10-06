/** Shapes returned by /api/v1/analytics/* (Phase 20). Mirrors apps/api/src/modules/analytics. */

export type MetricUnit = 'CURRENCY' | 'COUNT' | 'PERCENT' | 'MINUTES';
export type ComparisonStatus = 'OK' | 'NO_BASELINE' | 'INSUFFICIENT_DATA';

export interface Comparison {
  current: number;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
  direction: 'UP' | 'DOWN' | 'FLAT' | null;
  status: ComparisonStatus;
  note?: string;
}

export interface AgeingRow {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface MetricResult {
  key: string;
  name: string;
  domain: 'SALES' | 'FINANCE' | 'CUSTOMERS' | 'SUPPORT';
  unit: MetricUnit;
  accuracy: 'EXACT' | 'APPROXIMATE';
  status: 'OK' | 'UNAVAILABLE';
  value: number | null;
  comparison: Comparison | null;
  unavailableReason?: string;
  details?: Record<string, unknown> & { ageing?: AgeingRow[] };
}

export interface UnavailableMetric {
  key: string;
  name: string;
  reason: string;
  whatWouldFixIt: string;
}

export interface OverviewResponse {
  meta: {
    generatedAt: string;
    freshness: 'LIVE';
    freshnessNote: string;
    definitionsVersion: string;
    currency: string;
    scope: { description: string; branchId: string | null; branchLocked: boolean; platformWide: boolean };
    range: { preset: string; label: string; start: string; end: string; inProgress: boolean };
    comparison: { label: string; start: string; end: string } | null;
    historyStartsAt: string | null;
    warnings: string[];
  };
  metrics: MetricResult[];
  unavailable: UnavailableMetric[];
}

export interface TrendResponse {
  meta: { metric: string; name: string; unit: MetricUnit; granularity: 'day' | 'week' | 'month'; currency: string };
  status: 'OK' | 'UNAVAILABLE';
  unavailableReason?: string;
  points: { key: string; value: number }[];
}

export interface BranchesResponse {
  branches: { branchId: string | null; name: string; bookedValue: number; bookings: number }[];
}

export interface QualityCheck {
  key: string;
  title: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  count: number;
  description: string;
  affects: string[];
  sampleIds: string[];
}

export interface DataQualityReport {
  generatedAt: string;
  scope: string;
  status: 'CLEAN' | 'ISSUES';
  summary: { errors: number; warnings: number; info: number };
  checks: QualityCheck[];
  notes: string[];
}

export interface MetricDefinition {
  key: string;
  name: string;
  domain: string;
  unit: MetricUnit;
  audience: 'EXECUTIVE' | 'FINANCE';
  definition: string;
  calculation: string;
  dateBasis: string;
  source: string;
  caveats: string[];
  accuracy: 'EXACT' | 'APPROXIMATE';
  branchScopable: boolean;
  pointInTime: boolean;
}

export interface DefinitionsResponse {
  version: string;
  metrics: MetricDefinition[];
  unavailable: UnavailableMetric[];
}
