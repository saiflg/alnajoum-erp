/**
 * Phase 21 — the triggers a workflow can start from.
 *
 * Only events that a real service publishes are listed as available. The Phase 21
 * brief names many more triggers (visa document missing, installment overdue, flight
 * schedule change…); those need their publishing site built in the owning module first, and
 * are listed under UNAVAILABLE_TRIGGERS with the reason so nobody builds a workflow that
 * can never fire. Each event declares the context fields it provides, which is what
 * conditions and message templates are checked against when a workflow is activated.
 */

export interface TriggerInfo {
  type: string;
  label: string;
  description: string;
  /** Dotted paths available to conditions and templates (in addition to `event.*` and `steps.*`). */
  fields: string[];
}

const CUSTOMER = ['customer.id'];

export const TRIGGER_CATALOG: readonly TriggerInfo[] = [
  {
    type: 'payment.succeeded',
    label: 'Payment received',
    description:
      'An online payment on an invoice was confirmed by the payment provider.',
    fields: [
      'payment.invoiceId',
      'payment.amount',
      'payment.currency',
      ...CUSTOMER,
    ],
  },
  {
    type: 'flight.ticket_issued',
    label: 'Flight ticket issued',
    description: 'A flight booking was ticketed.',
    fields: [
      'booking.id',
      'booking.reference',
      'booking.totalAmount',
      'booking.currency',
      'booking.origin',
      'booking.destination',
      'booking.departureAt',
      ...CUSTOMER,
    ],
  },
  {
    type: 'hotel.booking_completed',
    label: 'Hotel stay completed',
    description: 'A hotel booking was marked completed.',
    fields: [
      'booking.id',
      'booking.reference',
      'booking.totalAmount',
      'booking.currency',
      ...CUSTOMER,
    ],
  },
  {
    type: 'visa.status_changed',
    label: 'Visa application status changed',
    description: 'A visa application moved to a new status.',
    fields: ['visa.id', 'visa.status', ...CUSTOMER],
  },
  {
    type: 'support_ticket.created',
    label: 'Support ticket created',
    description: 'A customer opened a support ticket.',
    fields: ['ticket.id', 'ticket.number', 'ticket.priority', ...CUSTOMER],
  },
  {
    type: 'lead.created',
    label: 'Lead created',
    description: 'A new CRM lead was recorded.',
    fields: ['lead.id', 'lead.number', 'lead.source', 'lead.priority'],
  },
];

/** Dynamic families: `schedule.<workflowId>` (time-based) and `custom.<name>` (emitted by another workflow). */
export const DYNAMIC_TRIGGER_PREFIXES = ['schedule.', 'custom.'] as const;

export const UNAVAILABLE_TRIGGERS: readonly { type: string; reason: string }[] =
  [
    {
      type: 'visa.document_missing / visa.document_uploaded',
      reason:
        'Visa documents publish no event yet; a status change is available instead.',
    },
    {
      type: 'installment.due / installment.overdue',
      reason:
        'There is no installment or payment-plan model and invoices have no due date, so there is nothing to fire on.',
    },
    {
      type: 'customer.registered',
      reason:
        'Registration lives in the authentication service, which is being hardened in the security phase; it will publish this event there.',
    },
    {
      type: 'flight.schedule_changed',
      reason:
        'The schedule-change model exists in the schema but no service detects or records changes.',
    },
    {
      type: 'quotation.created / quotation.expired',
      reason: 'There is no quotation model.',
    },
    {
      type: 'passport.nearing_expiry',
      reason:
        'Passport expiry is stored but nothing sweeps it; a scheduled workflow could, once a sweep action exists.',
    },
    {
      type: 'supplier.* / contract.expiring',
      reason:
        'Supplier events are not published; contract expiry is only a read-only list.',
    },
    {
      type: 'inventory.low / pricing_rule.changed / analytics.alert',
      reason: 'No publishing site exists yet.',
    },
    {
      type: 'agent.* / marketplace.* / corporate.*',
      reason:
        'Agents/resellers and the marketplace do not exist; corporate bookings publish nothing yet.',
    },
  ];

const BY_TYPE = new Map(TRIGGER_CATALOG.map((t) => [t.type, t]));

export const isKnownTrigger = (type: string): boolean =>
  BY_TYPE.has(type) || DYNAMIC_TRIGGER_PREFIXES.some((p) => type.startsWith(p));

/** Fields conditions/templates may use for a trigger (plus always the event block and step outputs). */
export function fieldsFor(type: string | undefined): Set<string> {
  const set = new Set<string>([
    'event.id',
    'event.type',
    'event.entityType',
    'event.entityId',
    'event.occurredAt',
    'event.correlationId',
    'steps.*',
  ]);
  const info = type ? BY_TYPE.get(type) : undefined;
  if (info) info.fields.forEach((f) => set.add(f));
  // schedule.* and custom.* carry caller-chosen payloads, so anything beneath the payload roots is allowed.
  if (type?.startsWith('schedule.')) set.add('schedule.*');
  if (type?.startsWith('custom.'))
    return new Set([
      'event.*',
      'steps.*',
      'customer.*',
      'booking.*',
      'visa.*',
      'ticket.*',
      'lead.*',
      'payment.*',
    ]);
  return set;
}
