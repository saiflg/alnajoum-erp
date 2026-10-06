/**
 * Phase 20 — the ONE place a KPI is defined.
 *
 * The audit found at least ten different meanings of "revenue" across the
 * existing reports (ticketed vs completed vs "not cancelled" vs cash received…).
 * Each metric here has exactly one definition, a name that says what it really
 * measures, and the caveats a reader needs. Calculation code (MetricsService)
 * must use the status sets exported below — never an inline list — so the
 * definition and the number cannot drift apart.
 *
 * Nothing here touches the database; it is data plus pure helpers.
 */
import { FlightBookingStatus, HotelBookingStatus } from '@prisma/client';

export const METRIC_DEFINITIONS_VERSION = '1.0.0';

export type MetricUnit = 'CURRENCY' | 'COUNT' | 'PERCENT' | 'MINUTES';
export type MetricDomain = 'SALES' | 'FINANCE' | 'CUSTOMERS' | 'SUPPORT';
export type MetricAccuracy = 'EXACT' | 'APPROXIMATE';
/** Who may read it: finance figures expose cost, margin and money owed. */
export type MetricAudience = 'EXECUTIVE' | 'FINANCE';

/**
 * A booking counts as an ACTIVE SALE once it is confirmed and has not been lost
 * again. PENDING (not yet confirmed), FAILED, CANCELLED and REFUNDED never count.
 * A refund REQUEST is still a sale until the refund actually happens.
 */
export const ACTIVE_FLIGHT_STATUSES: FlightBookingStatus[] = [
  FlightBookingStatus.CONFIRMED,
  FlightBookingStatus.TICKETED,
  FlightBookingStatus.REFUND_REQUESTED,
  FlightBookingStatus.REISSUE_REQUESTED,
  FlightBookingStatus.REISSUED,
];

export const ACTIVE_HOTEL_STATUSES: HotelBookingStatus[] = [
  HotelBookingStatus.CONFIRMED,
  HotelBookingStatus.COMPLETED,
  HotelBookingStatus.REFUND_REQUESTED,
];

export const CANCELLED_FLIGHT_STATUSES: FlightBookingStatus[] = [
  FlightBookingStatus.CANCELLED,
];
export const CANCELLED_HOTEL_STATUSES: HotelBookingStatus[] = [
  HotelBookingStatus.CANCELLED,
];

export interface MetricDefinition {
  key: string;
  name: string;
  domain: MetricDomain;
  unit: MetricUnit;
  audience: MetricAudience;
  /** One plain-English sentence: what is counted. */
  definition: string;
  /** Exactly how it is calculated, including which records are included. */
  calculation: string;
  /** Which date a record is placed on a period by. */
  dateBasis: string;
  /** Where the data comes from. */
  source: string;
  /** What the figure is NOT, and any known distortion. */
  caveats: string[];
  accuracy: MetricAccuracy;
  /** Can the metric be restricted to one branch? Money tables without a branch column cannot. */
  branchScopable: boolean;
  /** `true` for a point-in-time balance (receivables), `false` for a figure over a period. */
  pointInTime: boolean;
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: 'booked_value',
    name: 'Booked value (flights & hotels)',
    domain: 'SALES',
    unit: 'CURRENCY',
    audience: 'EXECUTIVE',
    definition:
      'The total price customers agreed to pay for flight and hotel bookings that are active sales.',
    calculation:
      "Sum of totalAmount over flight bookings in {CONFIRMED, TICKETED, REFUND_REQUESTED, REISSUE_REQUESTED, REISSUED} and hotel bookings in {CONFIRMED, COMPLETED, REFUND_REQUESTED}, in the company's base currency only.",
    dateBasis: 'Booking creation date (createdAt)',
    source: 'flight_bookings, hotel_bookings',
    caveats: [
      'This is the value SOLD, not money received (see cash_collected) and not accounting revenue.',
      'Visa, Hajj, Umrah and other services are not included yet.',
      'Bookings in a currency other than the company base currency are excluded and counted separately.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'bookings_count',
    name: 'Bookings (flights & hotels)',
    domain: 'SALES',
    unit: 'COUNT',
    audience: 'EXECUTIVE',
    definition:
      'The number of flight and hotel bookings that are active sales.',
    calculation: 'Count of the same records included in booked_value.',
    dateBasis: 'Booking creation date (createdAt)',
    source: 'flight_bookings, hotel_bookings',
    caveats: [
      'Failed, pending and cancelled bookings are not counted, unlike some older per-module reports that count every status.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'average_booking_value',
    name: 'Average booking value',
    domain: 'SALES',
    unit: 'CURRENCY',
    audience: 'EXECUTIVE',
    definition: 'Booked value divided by the number of bookings.',
    calculation:
      'booked_value / bookings_count, rounded half-up to a whole currency unit. Not shown when there are no bookings.',
    dateBasis: 'Booking creation date (createdAt)',
    source: 'derived from booked_value and bookings_count',
    caveats: ['Mixes flights and hotels; a shift in mix moves the average.'],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'cancellations',
    name: 'Cancelled bookings (flights & hotels)',
    domain: 'SALES',
    unit: 'COUNT',
    audience: 'EXECUTIVE',
    definition:
      'The number of flight and hotel bookings now in CANCELLED status.',
    calculation:
      'Count of bookings with status CANCELLED whose last-updated date falls in the period.',
    dateBasis:
      'Last update date (updatedAt) — bookings have no cancelled-at timestamp',
    source: 'flight_bookings, hotel_bookings',
    caveats: [
      'APPROXIMATE: the cancellation date is not stored, so the last update is used. A later edit to an already-cancelled booking moves it into a newer period.',
    ],
    accuracy: 'APPROXIMATE',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'gross_margin',
    name: 'Gross margin on bookings with known cost',
    domain: 'FINANCE',
    unit: 'CURRENCY',
    audience: 'FINANCE',
    definition:
      'Booked value minus supplier cost, over only those bookings whose supplier cost was recorded.',
    calculation:
      'For active-sale flights (providerCost) and hotels (supplierCost): sum(totalAmount - cost) where cost IS NOT NULL. Reported with cost coverage = bookings with a cost / all active bookings.',
    dateBasis: 'Booking creation date (createdAt)',
    source: 'flight_bookings, hotel_bookings',
    caveats: [
      'A missing cost is NEVER treated as zero (older reports did, which overstated margin). Bookings without a cost are excluded and the coverage % says how much of the book this represents.',
      'Before tax, before staff incentives, not accounting profit.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'cash_collected',
    name: 'Cash collected',
    domain: 'FINANCE',
    unit: 'CURRENCY',
    audience: 'FINANCE',
    definition: 'Money actually received from customers in the period.',
    calculation:
      'Sum of payment amounts whose paidAt falls in the period, on invoices that are not VOID, for customers of the company.',
    dateBasis: 'Payment date (paidAt)',
    source: 'payments, invoices, customers',
    caveats: [
      'Cash basis. It matches how the ledger recognises revenue, but it is not the ledger: this figure is customer-attributable and tenant-safe, the ledger is not.',
      'Payments on corporate invoices with no customer cannot be attributed to a company and are excluded.',
      'Payments carry no branch, so this metric is unavailable when a single branch is selected.',
      'Wallet top-ups are not payments against an invoice and are not included.',
    ],
    accuracy: 'EXACT',
    branchScopable: false,
    pointInTime: false,
  },
  {
    key: 'receivables_outstanding',
    name: 'Receivables outstanding',
    domain: 'FINANCE',
    unit: 'CURRENCY',
    audience: 'FINANCE',
    definition: 'Invoiced money not yet received, as of now.',
    calculation:
      'For invoices ISSUED or PARTIALLY_PAID: totalAmount minus the sum of its payments (never below zero). Aged by days since the invoice was issued.',
    dateBasis: 'As of the time the report is generated',
    source: 'invoices, payments, customers',
    caveats: [
      'Invoices have no due date, so ageing counts days SINCE ISSUE, not days overdue. Buckets are labelled accordingly.',
      'Corporate invoices with no customer cannot be attributed to a company and are excluded.',
      'Unavailable for a single branch (invoices carry no branch).',
    ],
    accuracy: 'EXACT',
    branchScopable: false,
    pointInTime: true,
  },
  {
    key: 'supplier_payables_outstanding',
    name: 'Supplier payables outstanding',
    domain: 'FINANCE',
    unit: 'CURRENCY',
    audience: 'FINANCE',
    definition:
      'What the company owes suppliers and has not yet paid, as of now.',
    calculation:
      'Sum of (amount - amountPaid) over payables that are not PAID. Aged by days past the due date.',
    dateBasis: 'As of the time the report is generated',
    source: 'supplier_payables',
    caveats: [
      'Payables without a due date are reported as "No due date", not guessed.',
      'Cost is posted only for flights, hotels and visas; Hajj, Umrah and other services create no payable.',
      'Unavailable for a single branch (payables carry no branch).',
    ],
    accuracy: 'EXACT',
    branchScopable: false,
    pointInTime: true,
  },
  {
    key: 'new_customers',
    name: 'New customers',
    domain: 'CUSTOMERS',
    unit: 'COUNT',
    audience: 'EXECUTIVE',
    definition: 'Customers whose record was created in the period.',
    calculation:
      'Count of customers created in the period for the company (by assigned branch when a branch is selected).',
    dateBasis: 'Customer creation date (createdAt)',
    source: 'customers',
    caveats: [
      'Self-registered customers with no assigned branch are only counted at company level.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'active_customers',
    name: 'Active customers',
    domain: 'CUSTOMERS',
    unit: 'COUNT',
    audience: 'EXECUTIVE',
    definition:
      'Distinct customers with at least one active-sale flight or hotel booking in the period.',
    calculation:
      'Count of distinct customerId across the bookings included in bookings_count.',
    dateBasis: 'Booking creation date (createdAt)',
    source: 'flight_bookings, hotel_bookings',
    caveats: [
      'No "active customer" figure existed before; this is the single definition. Visa/Hajj/Umrah-only customers are not counted yet.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'repeat_customer_rate',
    name: 'Repeat customer rate',
    domain: 'CUSTOMERS',
    unit: 'PERCENT',
    audience: 'EXECUTIVE',
    definition:
      'The share of active customers who had also made an active-sale booking before the period began.',
    calculation:
      'customers with a booking in the period AND an earlier booking / active_customers x 100, to two decimals.',
    dateBasis: 'Booking creation date (createdAt)',
    source: 'flight_bookings, hotel_bookings',
    caveats: [
      'Earlier history before the system held data is invisible, so the rate is a lower bound for young tenants.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
  {
    key: 'support_tickets',
    name: 'Support tickets',
    domain: 'SUPPORT',
    unit: 'COUNT',
    audience: 'EXECUTIVE',
    definition:
      'Support tickets opened in the period, with how many breached their response SLA and how fast the first reply was.',
    calculation:
      'Count of tickets created in the period; SLA breach rate = slaBreached / opened; average first response = mean(firstRespondedAt - createdAt) over tickets that have been answered.',
    dateBasis: 'Ticket creation date (createdAt)',
    source: 'support_tickets, customers',
    caveats: [
      'The SLA covers first response only; there is no resolution-time SLA.',
      'Average first response ignores tickets not yet answered and is not shown when none have been.',
    ],
    accuracy: 'EXACT',
    branchScopable: true,
    pointInTime: false,
  },
] as const;

/** Things the business may ask for that the data cannot support. Shown as unavailable, never estimated. */
export interface UnavailableMetric {
  key: string;
  name: string;
  reason: string;
  whatWouldFixIt: string;
}

export const UNAVAILABLE_METRICS: readonly UnavailableMetric[] = [
  {
    key: 'search_to_book_conversion',
    name: 'Search-to-booking conversion',
    reason:
      'Searches are logged without tenant, customer, route or channel, and offer views and abandoned carts are not recorded at all.',
    whatWouldFixIt:
      'Record a search/offer-view event with tenant, channel and route.',
  },
  {
    key: 'channel_attribution',
    name: 'Bookings by channel (web, mobile, WhatsApp)',
    reason:
      'Bookings store no channel or source field, and it cannot be derived reliably.',
    whatWouldFixIt: 'Add a channel column set at booking creation.',
  },
  {
    key: 'app_engagement',
    name: 'Mobile app sessions and active users',
    reason:
      'Only the last-active time per device is kept (overwritten); there are no sessions or opens.',
    whatWouldFixIt: 'Record session events.',
  },
  {
    key: 'budget_vs_actual',
    name: 'Budget / target vs actual',
    reason: 'No budget, target or quota model exists.',
    whatWouldFixIt: 'Add budget and target tables owned by finance.',
  },
  {
    key: 'forecast',
    name: 'Revenue and demand forecast',
    reason:
      'Insufficient historical data: no forecasting model exists and the system does not hold enough history to train one honestly. Forecasts are never shown as actuals.',
    whatWouldFixIt:
      'Accumulate at least 12 months of history, then add a labelled forecast model.',
  },
  {
    key: 'quote_pipeline',
    name: 'Quotation pipeline and quote conversion',
    reason: 'There is no quotation or opportunity model, only leads.',
    whatWouldFixIt: 'Add quotation records.',
  },
  {
    key: 'customer_acquisition_cost',
    name: 'Customer acquisition cost and channel ROI',
    reason:
      'Customers carry no acquisition channel and campaigns have no spend actuals.',
    whatWouldFixIt:
      'Store acquisition source on the customer and record campaign spend.',
  },
  {
    key: 'ledger_profit_and_loss_per_company',
    name: 'Accounting profit & loss per company',
    reason:
      'The ledger has no company column, so a tenant-safe P&L cannot be produced. The existing platform-wide P&L also treats ledger reversals inconsistently.',
    whatWouldFixIt:
      'Add companyId to journal entries and fix reversal handling.',
  },
  {
    key: 'receivables_by_due_date',
    name: 'Receivables ageing by due date',
    reason:
      'Invoices have no due date, so only ageing since issue is possible (see receivables_outstanding).',
    whatWouldFixIt: 'Add a due date or payment terms to invoices.',
  },
  {
    key: 'airline_performance',
    name: 'Airline-level performance',
    reason:
      'The airline is stored only inside an itinerary JSON snapshot, not as a column.',
    whatWouldFixIt: 'Store the marketing carrier as a column.',
  },
  {
    key: 'lead_funnel_per_company',
    name: 'Lead funnel per company',
    reason:
      'Leads have no company column; unassigned leads cannot be attributed to a tenant.',
    whatWouldFixIt: 'Add companyId to leads.',
  },
  {
    key: 'nps',
    name: 'Net Promoter Score',
    reason: 'Only a star rating exists; there is no 0–10 recommend question.',
    whatWouldFixIt: 'Add an NPS survey.',
  },
] as const;

const BY_KEY = new Map(METRIC_DEFINITIONS.map((m) => [m.key, m]));

export function getMetricDefinition(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

/** Metrics a caller may see, given whether they hold the finance-analytics permission. */
export function visibleDefinitions(
  canViewFinance: boolean,
): MetricDefinition[] {
  return METRIC_DEFINITIONS.filter(
    (m) => m.audience === 'EXECUTIVE' || canViewFinance,
  );
}
