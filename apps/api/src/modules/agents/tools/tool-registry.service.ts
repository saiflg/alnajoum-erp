import { Injectable } from '@nestjs/common';
import {
  AiRiskLevel,
  FlightBookingStatus,
  InvoiceStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AiAnalyticsService } from '../../ai/ai-analytics.service';
import { coerceParams, findQuerySpec } from '../../ai/analytics-query-registry';
import { TasksService } from '../../crm/tasks.service';
import { CurrencyService } from '../../finance/currency.service';
import { FlightRefundsService } from '../../flights/flight-refunds.service';
import { FlightTicketingService } from '../../flights/flight-ticketing.service';
import { FlightsService } from '../../flights/flights.service';
import { ReadinessService } from '../../hajj-ops/readiness.service';
import { HotelsService } from '../../hotels/hotels.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaymentsService } from '../../payments/payments.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { SupportTicketsService } from '../../support/support-tickets.service';
import { VisaChecklistService } from '../../visa/visa-checklist.service';
import { WalletService } from '../../wallet/wallet.service';
import {
  ActionPreview,
  ToolDefinition,
  ToolField,
  ToolResult,
} from '../agent.types';
import { filterOutput } from '../runtime/guards';
import { AiKnowledgeService } from '../services/knowledge.service';
import { AiMemoryService } from '../services/memory.service';
import { AiRecommendationsService } from '../services/recommendations.service';
import { ToolError, money, resolveCustomer } from './tool-support';

const S = (description: string, extra: Partial<ToolField> = {}): ToolField => ({
  type: 'string',
  description,
  ...extra,
});
const N = (description: string, extra: Partial<ToolField> = {}): ToolField => ({
  type: 'number',
  description,
  ...extra,
});
const D = (description: string, extra: Partial<ToolField> = {}): ToolField => ({
  type: 'date',
  description,
  ...extra,
});
const B = (description: string, extra: Partial<ToolField> = {}): ToolField => ({
  type: 'boolean',
  description,
  ...extra,
});

const ALL_STAFF: ToolDefinition['audiences'] = [
  'STAFF',
  'OPERATIONS',
  'EXECUTIVE',
  'SYSTEM',
];
const EVERYONE: ToolDefinition['audiences'] = ['CUSTOMER', ...ALL_STAFF];

const asStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : undefined;

/**
 * Every capability an agent has is declared here, with its risk class, who may use it and what it returns.
 * Tools are the ONLY way an agent touches the system: each one goes through the existing business service
 * (pricing, booking, payments, tasks, notifications, readiness...) or a tenant-filtered read, validates its input,
 * and returns only filtered fields. There is no tool that runs SQL, reads a table by name or returns a raw row.
 */
@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly flights: FlightsService,
    private readonly flightRefunds: FlightRefundsService,
    private readonly ticketing: FlightTicketingService,
    private readonly hotels: HotelsService,
    private readonly payments: PaymentsService,
    private readonly wallet: WalletService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
    private readonly readiness: ReadinessService,
    private readonly visaChecklist: VisaChecklistService,
    private readonly analytics: AiAnalyticsService,
    private readonly knowledge: AiKnowledgeService,
    private readonly memory: AiMemoryService,
    private readonly recommendations: AiRecommendationsService,
    private readonly currency: CurrencyService,
    private readonly support: SupportTicketsService,
  ) {
    for (const t of [
      ...this.readTools(),
      ...this.writeTools(),
      ...this.highRiskTools(),
    ]) {
      this.tools.set(t.key, t);
    }
  }

  get(key: string): ToolDefinition | undefined {
    return this.tools.get(key);
  }
  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }
  /** What the model is told about a tool (never the handler). */
  describe(keys: string[]) {
    return keys
      .map((k) => this.tools.get(k))
      .filter((t): t is ToolDefinition => !!t)
      .map((t) => ({
        tool: t.key,
        description: t.description,
        risk: t.risk,
        input: Object.fromEntries(
          Object.entries(t.input).map(([k, f]) => [
            k,
            `${f.type}${f.required ? ' (required)' : ''} - ${f.description}`,
          ]),
        ),
      }));
  }

  // ------------------------------------------------------------------ read-only
  private readTools(): ToolDefinition[] {
    const p = this.prisma;
    const res = (
      data: Record<string, unknown>,
      sources: string[],
      extra: Partial<ToolResult> = {},
    ): ToolResult => ({
      data: filterOutput(data),
      sources,
      ...extra,
    });

    return [
      {
        key: 'getCustomerProfile',
        description:
          "The customer's own profile: name, language, contact status and which documents are on file.",
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: {
          customerId: S(
            'Customer id (staff only; customers always get their own)',
          ),
        },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const [row, docs] = await Promise.all([
            p.customer.findUnique({
              where: { id: c.id },
              select: {
                firstName: true,
                lastName: true,
                nationality: true,
                preferredLanguage: true,
                passportExpiryDate: true,
                whatsappOptIn: true,
                customerType: true,
              },
            }),
            p.customerDocument.findMany({
              where: { customerId: c.id },
              select: { type: true },
            }),
          ]);
          return res(
            {
              customerId: c.id,
              ...row,
              documentsOnFile: [...new Set(docs.map((d) => d.type))],
            },
            ['ERP customer record'],
          );
        },
      },
      {
        key: 'getMyBookings',
        description:
          "A customer's bookings and registrations (flights, hotels, Hajj, Umrah, visas) with status and amount.",
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: { customerId: S('Customer id (staff only)') },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const [flights, hotels, hajj, umrah, visas] = await Promise.all([
            p.flightBooking.findMany({
              where: { customerId: c.id },
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: {
                id: true,
                bookingReference: true,
                status: true,
                origin: true,
                destination: true,
                departureAt: true,
                totalAmount: true,
                currency: true,
                refundable: true,
              },
            }),
            p.hotelBooking.findMany({
              where: { customerId: c.id },
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: {
                id: true,
                bookingReference: true,
                status: true,
                hotelName: true,
                checkInDate: true,
                checkOutDate: true,
                totalAmount: true,
                currency: true,
              },
            }),
            p.hajjRegistration.findMany({
              where: { customerId: c.id },
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                registrationNumber: true,
                status: true,
                totalAmount: true,
                currency: true,
              },
            }),
            p.umrahRegistration.findMany({
              where: { customerId: c.id },
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                registrationNumber: true,
                status: true,
                totalAmount: true,
                currency: true,
              },
            }),
            p.visaApplication.findMany({
              where: { customerId: c.id },
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true,
                applicationReference: true,
                status: true,
                destinationCountry: true,
                visaType: true,
              },
            }),
          ]);
          const m = <T extends { totalAmount: number; currency: string }>(
            r: T,
          ) => ({ ...r, total: money(r.totalAmount, r.currency) });
          return res(
            {
              flights: flights.map(m),
              hotels: hotels.map(m),
              hajj: hajj.map(m),
              umrah: umrah.map(m),
              visas,
              counts: {
                flights: flights.length,
                hotels: hotels.length,
                hajj: hajj.length,
                umrah: umrah.length,
                visas: visas.length,
              },
            },
            ['ERP bookings'],
          );
        },
      },
      {
        key: 'getBooking',
        description:
          'One flight booking in detail, including the fare conditions snapshotted when it was booked.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: {
          bookingReference: S('The booking reference, e.g. ANJ-12345', {
            required: true,
          }),
        },
        execute: async (ctx, input) => {
          const b = await p.flightBooking.findFirst({
            where: {
              bookingReference: String(input.bookingReference),
              customer: { companyId: ctx.principal.companyId ?? '__none__' },
            },
            include: {
              customer: { select: { id: true, assignedBranchId: true } },
              invoice: {
                select: { id: true, invoiceNumber: true, status: true },
              },
            },
          });
          if (
            !b ||
            (ctx.principal.kind === 'CUSTOMER' &&
              b.customerId !== ctx.principal.customerId) ||
            (ctx.principal.branchLimited &&
              ctx.principal.branchId &&
              b.customer.assignedBranchId &&
              b.customer.assignedBranchId !== ctx.principal.branchId)
          )
            throw new ToolError('NOT_FOUND', 'Booking not found');
          return res(
            {
              reference: b.bookingReference,
              status: b.status,
              origin: b.origin,
              destination: b.destination,
              departureAt: b.departureAt,
              cabinClass: b.cabinClass,
              total: money(b.totalAmount, b.currency),
              refundable: b.refundable,
              baggageAllowance: b.baggageAllowance,
              fareRules: b.fareRules,
              providerWarnings: b.providerWarnings,
              pnr: b.pnr,
              ticketedAt: b.ticketedAt,
              holdExpiresAt: b.holdExpiresAt,
              invoice: b.invoice
                ? {
                    id: b.invoice.id,
                    number: b.invoice.invoiceNumber,
                    status: b.invoice.status,
                  }
                : null,
            },
            [
              'ERP flight booking',
              'Flight provider fare conditions (as snapshotted at booking)',
            ],
            { resourceType: 'FlightBooking', resourceId: b.id },
          );
        },
      },
      {
        key: 'getCustomerBalance',
        description:
          'What the customer still owes (per unpaid invoice) and their wallet balance, from the ledger of invoices and payments.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: { customerId: S('Customer id (staff only)') },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const invoices = await p.invoice.findMany({
            where: {
              customerId: c.id,
              status: {
                in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID],
              },
            },
            include: { payments: { select: { amount: true } } },
            orderBy: { createdAt: 'asc' },
            take: 20,
          });
          const rows = invoices.map((i) => {
            const paid = i.payments.reduce((s, x) => s + x.amount, 0);
            return {
              invoiceId: i.id,
              number: i.invoiceNumber,
              status: i.status,
              total: money(i.totalAmount, i.currency),
              paid: money(paid, i.currency),
              outstanding: money(i.totalAmount - paid, i.currency),
            };
          });
          const currencies = [
            ...new Set(rows.map((r) => r.outstanding.currency)),
          ];
          const w = await this.wallet.getWalletWithBalance(c.id);
          return res(
            {
              invoices: rows,
              // One total only when every invoice shares a currency; never add amounts across currencies.
              outstanding:
                currencies.length === 1
                  ? money(
                      rows.reduce((s, r) => s + r.outstanding.amount, 0),
                      currencies[0],
                    )
                  : null,
              mixedCurrencies: currencies.length > 1,
              walletBalance: money(
                w.balance,
                (w.wallet as { currency?: string }).currency ??
                  currencies[0] ??
                  'NGN',
              ),
              unpaidCount: rows.length,
            },
            ['ERP invoices and payments', 'Customer wallet'],
          );
        },
      },
      {
        key: 'getPaymentStatus',
        description:
          'The status of one invoice or one online payment attempt (by invoice id or checkout reference), taken from recorded payments only.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: {
          invoiceId: S('Invoice id'),
          reference: S('Checkout reference'),
        },
        execute: async (ctx, input) => {
          const cid = ctx.principal.companyId ?? '__none__';
          const intent = input.reference
            ? await p.paymentIntent.findFirst({
                where: {
                  reference: String(input.reference),
                  invoice: { customer: { companyId: cid } },
                },
                include: {
                  invoice: { select: { id: true, customerId: true } },
                },
              })
            : null;
          const invoiceId = asStr(input.invoiceId) ?? intent?.invoiceId;
          if (!invoiceId)
            throw new ToolError(
              'INVALID_INPUT',
              'An invoiceId or a checkout reference is needed',
            );
          const inv = await p.invoice.findFirst({
            where: { id: invoiceId, customer: { companyId: cid } },
            include: {
              payments: {
                select: { amount: true, method: true, paidAt: true },
              },
              paymentIntents: {
                select: {
                  reference: true,
                  status: true,
                  amount: true,
                  currency: true,
                  createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 5,
              },
            },
          });
          if (
            !inv ||
            (ctx.principal.kind === 'CUSTOMER' &&
              inv.customerId !== ctx.principal.customerId)
          )
            throw new ToolError('NOT_FOUND', 'Invoice not found');
          const paid = inv.payments.reduce((s, x) => s + x.amount, 0);
          return res(
            {
              invoiceNumber: inv.invoiceNumber,
              status: inv.status,
              total: money(inv.totalAmount, inv.currency),
              paid: money(paid, inv.currency),
              outstanding: money(inv.totalAmount - paid, inv.currency),
              payments: inv.payments.map((x) => ({
                amount: money(x.amount, inv.currency),
                method: x.method,
                paidAt: x.paidAt,
              })),
              onlineAttempts: inv.paymentIntents.map((i) => ({
                reference: i.reference,
                status: i.status,
                amount: money(i.amount, i.currency),
                at: i.createdAt,
              })),
              note: 'A payment counts only once it is recorded here; an online attempt marked PENDING is not a payment.',
            },
            ['ERP invoice', 'Recorded payments'],
            { resourceType: 'Invoice', resourceId: inv.id },
          );
        },
      },
      {
        key: 'getVisaApplications',
        description:
          "A customer's visa applications with status, the latest staff note and the missing/rejected documents from the checklist.",
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: { customerId: S('Customer id (staff only)') },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const apps = await p.visaApplication.findMany({
            where: { customerId: c.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
              id: true,
              applicationReference: true,
              status: true,
              destinationCountry: true,
              visaType: true,
              staffNote: true,
              intendedTravelDate: true,
            },
          });
          const out: Record<string, unknown>[] = [];
          for (const a of apps) {
            let missing: string[] = [];
            let rejected: string[] = [];
            try {
              const cl = await this.visaChecklist.computeChecklist(a.id);
              missing = cl.items
                .filter((i) => i.required && i.state === 'MISSING')
                .map((i) => i.documentType);
              rejected = cl.items
                .filter((i) => i.state === 'REJECTED' || i.state === 'EXPIRED')
                .map((i) => i.documentType);
            } catch {
              /* no checklist for this application type */
            }
            out.push({
              ...a,
              missingDocuments: missing,
              rejectedOrExpiredDocuments: rejected,
            });
          }
          return res({ applications: out, count: out.length }, [
            'ERP visa applications',
            'Visa document checklist',
          ]);
        },
      },
      {
        key: 'getPilgrimReadiness',
        description:
          'Readiness of a Hajj/Umrah pilgrim: documents, visa, payment, flight and hotel, with the reason for the overall status.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: {
          type: S('HAJJ or UMRAH', { required: true, enum: ['HAJJ', 'UMRAH'] }),
          pilgrimId: S('Pilgrim id from the registration', { required: true }),
        },
        execute: async (ctx, input) => {
          const type = input.type as 'HAJJ' | 'UMRAH';
          const pil =
            type === 'HAJJ'
              ? await p.hajjRegistrationPilgrim.findUnique({
                  where: { id: String(input.pilgrimId) },
                  include: {
                    registration: {
                      select: {
                        customer: {
                          select: {
                            id: true,
                            companyId: true,
                            assignedBranchId: true,
                          },
                        },
                      },
                    },
                  },
                })
              : await p.umrahRegistrationPilgrim.findUnique({
                  where: { id: String(input.pilgrimId) },
                  include: {
                    registration: {
                      select: {
                        customer: {
                          select: {
                            id: true,
                            companyId: true,
                            assignedBranchId: true,
                          },
                        },
                      },
                    },
                  },
                });
          const owner = pil?.registration.customer;
          if (
            !pil ||
            !owner ||
            owner.companyId !== ctx.principal.companyId ||
            (ctx.principal.kind === 'CUSTOMER' &&
              owner.id !== ctx.principal.customerId) ||
            (ctx.principal.branchLimited &&
              ctx.principal.branchId &&
              owner.assignedBranchId &&
              owner.assignedBranchId !== ctx.principal.branchId)
          )
            throw new ToolError('NOT_FOUND', 'Pilgrim not found');
          const r = await this.readiness.compute(type, pil.id);
          return res(
            {
              status: r.finalStatus,
              documentsComplete: r.documentsComplete,
              missingDocuments: r.missingDocuments,
              visa: r.visaStatus,
              paymentComplete: r.paymentComplete,
              outstanding: r.paymentComplete
                ? null
                : money(r.outstandingAmount, 'NGN'),
              flightAssigned: r.flightAssigned,
              hotelAssigned: r.hotelAssigned,
              overridden: !!r.override,
            },
            [
              'Hajj/Umrah readiness (computed live from documents, visa, payments and assignments)',
            ],
          );
        },
      },
      {
        key: 'searchFlights',
        description:
          'Searches the active flight providers. Returns normalised offers with price, baggage, refundability and change rules AS THE PROVIDER REPORTS THEM. Offers expire; always revalidate before booking.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['CUSTOMER', 'STAFF', 'OPERATIONS'],
        requiredPermissions: [],
        writes: false,
        input: {
          origin: S('3-letter airport code', { required: true, maxLength: 3 }),
          destination: S('3-letter airport code', {
            required: true,
            maxLength: 3,
          }),
          departureDate: D('Departure date', { required: true }),
          returnDate: D('Return date for a round trip'),
          adults: N('Adults, default 1', { min: 1, max: 9 }),
          cabinClass: S('ECONOMY, PREMIUM_ECONOMY, BUSINESS or FIRST', {
            enum: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'],
          }),
        },
        execute: async (_ctx, input) => {
          const origin = String(input.origin).toUpperCase();
          const destination = String(input.destination).toUpperCase();
          const legs = [
            { origin, destination, departureDate: String(input.departureDate) },
          ];
          if (input.returnDate)
            legs.push({
              origin: destination,
              destination: origin,
              departureDate: String(input.returnDate),
            });
          const offers = await this.flights.search({
            tripType: (input.returnDate ? 'ROUND_TRIP' : 'ONE_WAY') as never,
            legs: legs as never,
            adults: Number(input.adults ?? 1),
            cabinClass: input.cabinClass as never,
          } as never);
          const top = offers.slice(0, 5).map((o) => ({
            offerId: o.id,
            provider: o.provider,
            cabinClass: o.cabinClass,
            total: money(o.totalAmount, o.currency),
            seatsAvailable: o.seatsAvailable,
            expiresAt: o.expiresAt,
            legs: o.legs.map((l) => ({
              from: l.origin,
              to: l.destination,
              departs: l.departureAt,
              arrives: l.arrivalAt,
              airline: l.segments[0]?.airline,
              flight: l.segments[0]?.flightNumber,
            })),
            refundable: o.fareConditions?.refundable ?? 'UNKNOWN',
            baggage: o.fareConditions?.baggageAllowance ?? null,
            changeRules: o.fareConditions?.changePenaltyDescription ?? null,
            cancellationRules:
              o.fareConditions?.cancellationPenaltyDescription ?? null,
            providerWarnings: (o.fareConditions?.warnings ?? []).map((w) => ({
              message: w.message,
              verified: w.verified,
            })),
          }));
          return res(
            {
              count: offers.length,
              offers: top,
              note: 'Fare rules not listed here could not be verified from the provider.',
            },
            ['Flight provider response', 'Company pricing rules'],
          );
        },
      },
      {
        key: 'revalidateFlightOffer',
        description:
          'Re-checks an offer with the provider and returns the current price. REQUIRED before preparing any booking.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['CUSTOMER', 'STAFF', 'OPERATIONS'],
        requiredPermissions: [],
        writes: false,
        input: {
          offerId: S('Offer id', { required: true }),
          previousAmount: N('The price the customer saw', {
            required: true,
            min: 0,
          }),
        },
        execute: async (_ctx, input) => {
          const r = await this.flights.revalidate(
            String(input.offerId),
            Number(input.previousAmount),
          );
          return res(
            {
              offerId: r.offer.id,
              priceChanged: r.priceChanged,
              previous: money(r.previousAmount, r.offer.currency),
              current: money(r.currentAmount, r.offer.currency),
              refundable: r.offer.fareConditions?.refundable ?? 'UNKNOWN',
              expiresAt: r.offer.expiresAt,
            },
            ['Flight provider response (revalidated just now)'],
          );
        },
      },
      {
        key: 'getHotelAvailability',
        description:
          'Searches hotel availability and rates through the existing hotel providers.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['CUSTOMER', 'STAFF', 'OPERATIONS'],
        requiredPermissions: [],
        writes: false,
        input: {
          city: S('City', { required: true }),
          checkInDate: D('Check-in', { required: true }),
          checkOutDate: D('Check-out', { required: true }),
          rooms: N('Rooms', { min: 1, max: 9 }),
          guests: N('Guests', { min: 1, max: 20 }),
        },
        execute: async (_ctx, input) => {
          const offers = await this.hotels.search({
            city: String(input.city),
            checkInDate: String(input.checkInDate),
            checkOutDate: String(input.checkOutDate),
            rooms: Number(input.rooms ?? 1),
            guests: Number(input.guests ?? 1),
          } as never);
          return res(
            {
              count: offers.length,
              offers: offers.slice(0, 5).map((o) => ({
                offerId: o.id,
                hotel: o.hotelName,
                stars: o.starRating,
                roomType: o.roomType,
                total: money(o.totalAmount, o.currency),
                amenities: o.amenities.slice(0, 6),
                expiresAt: o.expiresAt,
              })),
            },
            ['Hotel provider response'],
          );
        },
      },
      {
        key: 'searchKnowledge',
        description:
          'Looks up company policy and procedure (refunds, visas, Hajj/Umrah, payments, support). Returns the entries with their source and version. If nothing matches, say so.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: {
          query: S('What to look up', { required: true }),
          category: S('Optional category'),
        },
        execute: async (ctx, input) => {
          const hits = await this.knowledge.search(
            String(input.query),
            {
              companyId: ctx.principal.companyId,
              branchId: ctx.principal.branchId,
            },
            asStr(input.category),
          );
          return res(
            { found: hits.length, entries: hits },
            hits.map(
              (h) => `${h.sourceLabel} (${h.scope.toLowerCase()} policy)`,
            ),
          );
        },
      },
      {
        key: 'getAnalyticsMetric',
        description:
          'Runs ONE of the approved analytics queries (executive_kpis, total_ticket_sales, top_routes_by_revenue, supplier_liabilities, pending_incentives, visas_expiring_soon, branch_sales, cancelled_bookings_count). No free-form queries exist.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['STAFF', 'OPERATIONS', 'EXECUTIVE', 'SYSTEM'],
        requiredPermissions: [PERMISSIONS.AI.ANALYTICS_QUERY],
        writes: false,
        input: {
          query: S('Query name from the approved list', { required: true }),
          days: N('Look-back days', { min: 1, max: 365 }),
          limit: N('Top N', { min: 1, max: 20 }),
        },
        execute: async (ctx, input) => {
          const spec = findQuerySpec(String(input.query));
          if (!spec)
            throw new ToolError(
              'INVALID_INPUT',
              'That is not an approved analytics query',
            );
          const params = coerceParams(spec, input);
          const pr = ctx.principal;
          const r = await this.analytics.execute(
            spec.name,
            params,
            pr.isSuperAdmin ? undefined : (pr.companyId ?? '__no_tenant__'),
            {
              sub: pr.identityId ?? '',
              type: 'STAFF',
              roles: pr.roles,
              permissions: pr.permissions,
              companyId: pr.companyId,
              sessionId: null,
            } as never,
          );
          return res(
            { query: spec.name, params, summary: r.summary, data: r.data },
            [`Analytics: ${spec.name}`],
          );
        },
      },
      {
        key: 'getSupplierStatus',
        description:
          'Flight supplier health: contract expiry, outstanding payables and recent provider failures.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['STAFF', 'OPERATIONS', 'EXECUTIVE', 'SYSTEM'],
        requiredPermissions: [PERMISSIONS.SUPPLIER.VIEW],
        writes: false,
        input: {},
        execute: async (ctx) => {
          const cid = ctx.principal.companyId ?? '__none__';
          const soon = new Date(Date.now() + 45 * 86_400_000);
          const [contracts, failures] = await Promise.all([
            p.flightSupplierContract
              .findMany({
                where: { supplier: { companyId: cid }, endDate: { lte: soon } },
                select: { endDate: true, supplier: { select: { name: true } } },
                orderBy: { endDate: 'asc' },
                take: 10,
              })
              .catch(() => []),
            p.providerTransactionLog
              .count({
                where: {
                  status: 'FAILURE',
                  createdAt: { gte: new Date(Date.now() - 86_400_000) },
                },
              })
              .catch(() => 0),
          ]);
          return res(
            {
              contractsExpiringIn45Days: contracts.map((c) => ({
                supplier: c.supplier.name,
                endsOn: c.endDate,
              })),
              providerFailuresLast24h: failures,
            },
            ['Supplier contracts', 'Provider transaction log'],
          );
        },
      },
      {
        key: 'getPendingApprovals',
        description:
          'Approval requests waiting for a decision in the staff member’s company.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['STAFF', 'OPERATIONS', 'EXECUTIVE'],
        requiredPermissions: [PERMISSIONS.APPROVAL.VIEW],
        writes: false,
        input: {},
        execute: async (ctx) => {
          const rows = await p.approvalRequest.findMany({
            where: {
              companyId: ctx.principal.companyId ?? '__none__',
              status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
            },
            orderBy: { createdAt: 'asc' },
            take: 20,
            select: {
              id: true,
              type: true,
              amount: true,
              currency: true,
              reason: true,
              createdAt: true,
            },
          });
          return res(
            {
              count: rows.length,
              approvals: rows.map((r) => ({
                id: r.id,
                type: r.type,
                reason: r.reason,
                since: r.createdAt,
                amount:
                  r.amount != null
                    ? money(r.amount, r.currency ?? 'NGN')
                    : null,
              })),
            },
            ['Approval engine'],
          );
        },
      },
      {
        key: 'getOperationalSummary',
        description:
          'The open exceptions and recommendations queue (sorted by priority), plus this staff member’s overdue tasks.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['STAFF', 'OPERATIONS', 'EXECUTIVE', 'SYSTEM'],
        requiredPermissions: [],
        writes: false,
        input: { limit: N('How many items', { min: 1, max: 20 }) },
        execute: async (ctx, input) => {
          const pr = ctx.principal;
          const recs = await this.recommendations.list(
            pr.companyId ?? undefined,
            { branchLimitedTo: pr.branchLimited ? pr.branchId : null },
            Number(input.limit ?? 8),
          );
          const overdue = pr.staffId
            ? await p.task.count({
                where: {
                  assignedStaffId: pr.staffId,
                  status: { in: ['PENDING', 'IN_PROGRESS'] },
                  dueDate: { lt: new Date() },
                },
              })
            : 0;
          return res(
            {
              queue: recs.map((r) => ({
                id: r.id,
                severity: r.severity,
                title: r.title,
                reason: r.reason,
                confidence: r.confidence,
                due: r.dueAt,
              })),
              openCount: recs.length,
              myOverdueTasks: overdue,
            },
            ['AI exception queue (rule-based scans)', 'CRM tasks'],
          );
        },
      },
      {
        key: 'getLeadsNeedingFollowUp',
        description:
          'Leads that have gone quiet or have an overdue follow-up, newest first.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: ['STAFF', 'OPERATIONS', 'SYSTEM'],
        requiredPermissions: [PERMISSIONS.CRM.LEAD_READ],
        writes: false,
        input: {},
        execute: async (ctx) => {
          const pr = ctx.principal;
          const cid = pr.companyId ?? '__none__';
          const rows = await p.lead.findMany({
            where: {
              status: 'OPEN',
              updatedAt: { lt: new Date(Date.now() - 3 * 86_400_000) },
              AND: [
                {
                  OR: [
                    { assignedStaff: { companyId: cid } },
                    { createdByStaff: { companyId: cid } },
                    { assignedBranch: { companyId: cid } },
                  ],
                },
                ...(pr.branchLimited && pr.branchId
                  ? [
                      {
                        OR: [
                          { assignedBranchId: pr.branchId },
                          { assignedStaffId: pr.staffId ?? '__none__' },
                        ],
                      },
                    ]
                  : []),
              ],
            },
            select: {
              id: true,
              leadNumber: true,
              name: true,
              status: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: 'asc' },
            take: 10,
          });
          return res(
            {
              count: rows.length,
              leads: rows.map((l) => ({
                leadId: l.id,
                number: l.leadNumber,
                name: l.name,
                status: l.status,
                quietSince: l.updatedAt,
              })),
            },
            ['CRM leads'],
          );
        },
      },
      {
        key: 'convertAmount',
        description:
          'Converts an amount to the platform base currency using the company exchange-rate table. Returns the original amount, the converted amount, the rate and the date the rate was set. Never guesses a rate.',
        risk: AiRiskLevel.READ_ONLY,
        audiences: EVERYONE,
        requiredPermissions: [],
        writes: false,
        input: {
          amount: N('Amount', { required: true, min: 0 }),
          fromCurrency: S('ISO currency code', {
            required: true,
            maxLength: 3,
          }),
        },
        execute: async (_ctx, input) => {
          const code = String(input.fromCurrency).toUpperCase();
          const amount = Number(input.amount);
          const converted = await this.currency.convertToBase(amount, code);
          const row = code === 'NGN' ? null : await this.currency.get(code);
          return res(
            {
              original: money(amount, code),
              converted: money(converted.amount, converted.currency),
              rate: code === 'NGN' ? 1 : (row?.exchangeRateToBase ?? null),
              rateDate: row?.updatedAt ?? null,
              note: 'Conversion uses the company exchange-rate table, not a market rate.',
            },
            ['Company exchange-rate table'],
          );
        },
      },
    ];
  }

  // ------------------------------------------------------------------ writes
  private writeTools(): ToolDefinition[] {
    const p = this.prisma;
    const res = (
      data: Record<string, unknown>,
      sources: string[],
      summary: string,
      extra: Partial<ToolResult> = {},
    ): ToolResult => ({
      data: filterOutput(data),
      sources,
      summary,
      ...extra,
    });

    return [
      {
        key: 'createTask',
        description:
          'Creates an internal staff task, assigned to a staff member of the same company.',
        risk: AiRiskLevel.LOW_RISK_WRITE,
        audiences: ['STAFF', 'OPERATIONS', 'SYSTEM'],
        requiredPermissions: [PERMISSIONS.CRM.TASK_MANAGE],
        writes: true,
        input: {
          title: S('Task title', { required: true, maxLength: 200 }),
          description: S('Details', { maxLength: 1500 }),
          assignedStaffId: S('Staff id (default: yourself)'),
          customerId: S('Related customer'),
          relatedType: S(
            'FOLLOW_UP, VISA, FLIGHT, HOTEL, HAJJ, UMRAH, PAYMENT, CUSTOMER, DOCUMENT',
            {
              enum: [
                'FOLLOW_UP',
                'VISA',
                'FLIGHT',
                'HOTEL',
                'HAJJ',
                'UMRAH',
                'PAYMENT',
                'CUSTOMER',
                'DOCUMENT',
              ],
            },
          ),
          dueInHours: N('Due in hours', { min: 1, max: 24 * 60 }),
          priority: S('LOW, NORMAL, HIGH, URGENT', {
            enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
          }),
        },
        execute: async (ctx, input) => {
          const pr = ctx.principal;
          const assignee = asStr(input.assignedStaffId) ?? pr.staffId;
          if (!assignee)
            throw new ToolError(
              'INVALID_INPUT',
              'Say which staff member the task is for',
            );
          const staff = await p.staff.findFirst({
            where: {
              id: assignee,
              companyId: pr.companyId ?? '__none__',
              isActive: true,
            },
            select: { id: true },
          });
          if (!staff)
            throw new ToolError(
              'NOT_FOUND',
              'That staff member does not exist in this company',
            );
          let customerId: string | undefined;
          if (input.customerId)
            customerId = (await resolveCustomer(p, pr, input.customerId)).id;
          const task = await this.tasks.create(
            {
              title: String(input.title),
              description: asStr(input.description),
              relatedType: (asStr(input.relatedType) ?? 'FOLLOW_UP') as never,
              customerId,
              assignedStaffId: staff.id,
              priority: (asStr(input.priority) ?? 'NORMAL') as never,
              dueDate: new Date(
                Date.now() + Number(input.dueInHours ?? 24) * 3600_000,
              ).toISOString(),
              notes: `Created by the ${ctx.agentKey} AI agent for a staff request.`,
            } as never,
            pr.staffId ?? undefined,
          );
          return res(
            { taskId: task.id, title: task.title },
            ['CRM tasks'],
            `Created task "${task.title}"`,
            { resourceType: 'Task', resourceId: task.id },
          );
        },
      },
      {
        key: 'createCRMFollowUp',
        description:
          'Creates a follow-up task for a customer or lead (convenience wrapper over createTask, kept separate so an agent can be allowed one without the other).',
        risk: AiRiskLevel.LOW_RISK_WRITE,
        audiences: ['STAFF', 'OPERATIONS', 'SYSTEM'],
        requiredPermissions: [PERMISSIONS.CRM.TASK_MANAGE],
        writes: true,
        input: {
          customerId: S('Customer', { required: true }),
          title: S('Follow-up', { required: true, maxLength: 200 }),
          dueInHours: N('Due in hours', { min: 1, max: 24 * 30 }),
        },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const assigneeId =
            ctx.principal.staffId ??
            (
              await p.customer.findUnique({
                where: { id: c.id },
                select: { assignedStaffId: true },
              })
            )?.assignedStaffId;
          if (!assigneeId)
            throw new ToolError(
              'INVALID_INPUT',
              'No staff member is assigned to this customer; assign one first',
            );
          const task = await this.tasks.create(
            {
              title: String(input.title),
              relatedType: 'FOLLOW_UP' as never,
              customerId: c.id,
              assignedStaffId: assigneeId,
              dueDate: new Date(
                Date.now() + Number(input.dueInHours ?? 24) * 3600_000,
              ).toISOString(),
              priority: 'NORMAL' as never,
            } as never,
            ctx.principal.staffId ?? undefined,
          );
          return res(
            { taskId: task.id },
            ['CRM tasks'],
            `Created follow-up "${task.title}"`,
            { resourceType: 'Task', resourceId: task.id },
          );
        },
      },
      {
        key: 'createSupportTicket',
        description:
          'Opens a support ticket on the customer’s behalf so a person follows up.',
        risk: AiRiskLevel.LOW_RISK_WRITE,
        audiences: ['CUSTOMER', 'STAFF'],
        requiredPermissions: [],
        writes: true,
        selfService: true,
        input: {
          subject: S('Subject', { required: true, maxLength: 150 }),
          description: S('What happened', { required: true, maxLength: 2000 }),
          categoryId: S('Category id'),
          customerId: S('Customer (staff only)'),
        },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const categoryId =
            asStr(input.categoryId) ??
            (await p.supportTicketCategory.findFirst({ select: { id: true } }))
              ?.id;
          if (!categoryId)
            throw new ToolError(
              'UNAVAILABLE',
              'No support categories are configured',
            );
          const t = await this.support.create(c.id, {
            subject: String(input.subject),
            description: String(input.description),
            categoryId,
          } as never);
          return res(
            { ticketNumber: t.ticketNumber },
            ['Support desk'],
            `Opened support ticket ${t.ticketNumber}`,
            { resourceType: 'SupportTicket', resourceId: t.id },
          );
        },
      },
      {
        key: 'createRecommendation',
        description:
          'Records a recommendation or an exception for staff, with its reason and the evidence. Does not change any business record.',
        risk: AiRiskLevel.LOW_RISK_WRITE,
        audiences: ['CUSTOMER', ...ALL_STAFF],
        requiredPermissions: [],
        writes: true,
        recommends: true,
        input: {
          title: S('Short title', { required: true, maxLength: 200 }),
          reason: S('Why', { required: true, maxLength: 1500 }),
          kind: S('Category, e.g. FOLLOW_UP', {
            required: true,
            maxLength: 60,
          }),
          subjectType: S('CUSTOMER, BOOKING...'),
          subjectId: S('Subject id'),
          confidence: S('HIGH, MEDIUM, LOW or UNKNOWN', {
            enum: ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'],
          }),
        },
        execute: async (ctx, input) => {
          const pr = ctx.principal;
          if (!pr.companyId) throw new ToolError('FORBIDDEN', 'No company');
          const r = await this.recommendations.upsert({
            companyId: pr.companyId,
            branchId: pr.branchId,
            agentKey: ctx.agentKey,
            kind: String(input.kind),
            dedupeKey: `agent:${ctx.agentKey}:${String(input.kind)}:${asStr(input.subjectId) ?? String(input.title).toLowerCase().slice(0, 60)}`,
            title: String(input.title),
            reason: String(input.reason),
            evidence: [
              {
                label: 'Raised by an agent from this conversation',
                source: `AI agent ${ctx.agentKey}`,
              },
            ],
            confidence: (asStr(input.confidence) ?? 'MEDIUM') as never,
            factors: {
              customerImpact: 1,
              regulatoryImpact: 0,
              dependency: 0,
              risk: 0,
            },
            subjectType: asStr(input.subjectType),
            subjectId: asStr(input.subjectId),
          });
          return res(
            { recommendationId: r.id, alreadyExisted: !r.created },
            ['AI recommendations'],
            r.created
              ? 'Recorded a recommendation'
              : 'That recommendation already exists',
          );
        },
      },
      {
        key: 'rememberPreference',
        description:
          'Remembers an approved customer preference (airline, cabin, hotel category, travel month, language). Only these keys are accepted.',
        risk: AiRiskLevel.LOW_RISK_WRITE,
        audiences: ['CUSTOMER', 'STAFF'],
        requiredPermissions: [],
        writes: true,
        selfService: true,
        input: {
          key: S(
            'preferredAirline, preferredCabin, preferredHotelCategory, preferredTravelMonth, preferredLanguage',
            { required: true },
          ),
          value: S('The value', { required: true, maxLength: 100 }),
        },
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, undefined);
          await this.memory.write({
            companyId: c.companyId,
            type: 'PREFERENCE',
            subjectType: 'CUSTOMER',
            subjectId: c.id,
            key: String(input.key),
            value: { value: input.value },
            source: ctx.agentKey,
          });
          return res(
            { remembered: String(input.key) },
            ['Customer preferences'],
            `Remembered ${String(input.key)}`,
          );
        },
      },
      // ---- MEDIUM risk
      {
        key: 'createPaymentLink',
        description:
          'Creates a secure online payment link for a customer’s own unpaid invoice. The link is created by the payment provider; this tool never handles card details and never marks anything paid.',
        risk: AiRiskLevel.MEDIUM_RISK,
        audiences: ['CUSTOMER', 'STAFF', 'OPERATIONS'],
        requiredPermissions: [],
        writes: true,
        selfService: true,
        idempotencyWindow: 'hour',
        input: { invoiceId: S('Invoice id', { required: true }) },
        execute: async (ctx, input) => {
          if (ctx.principal.kind !== 'CUSTOMER')
            throw new ToolError(
              'FORBIDDEN',
              'A payment link is created for the customer by the customer’s own session',
            );
          const c = await resolveCustomer(p, ctx.principal, undefined);
          const link = await this.payments.initiateCheckout(
            c.id,
            String(input.invoiceId),
          );
          return res(
            {
              paymentUrl: link.authorizationUrl,
              reference: link.reference,
              note: 'The payment is only confirmed after the provider reports it; it is not paid yet.',
            },
            ['Payment provider'],
            `Created payment link ${link.reference}`,
            { resourceType: 'Invoice', resourceId: String(input.invoiceId) },
          );
        },
      },
      {
        key: 'prepareFlightBooking',
        description:
          'Books the confirmed, revalidated offer through the normal booking workflow for the customer (creating the reservation and its invoice, awaiting payment). Does NOT issue a ticket. Needs the customer’s explicit confirmation and the price they were shown.',
        risk: AiRiskLevel.MEDIUM_RISK,
        audiences: ['CUSTOMER'],
        requiredPermissions: [],
        writes: true,
        selfService: true,
        idempotencyWindow: 'day',
        input: {
          offerId: S('Revalidated offer id', { required: true }),
          expectedPrice: N('The price the customer confirmed', {
            required: true,
            min: 1,
          }),
          customerConfirmed: B('The customer explicitly confirmed', {
            required: true,
          }),
        },
        preview: (i) => ({
          action: 'Reserve a flight for the customer',
          financialImpact: {
            amount: Number(i.expectedPrice),
            note: 'Invoice raised; payment still required',
          },
          risks: ['The fare may change before payment'],
          whatWillHappen: [
            'A reservation is created through the normal workflow',
            'An invoice is raised',
            'No ticket is issued',
          ],
          requiredApproval: 'Customer confirmation',
        }),
        execute: async (ctx, input) => {
          if (input.customerConfirmed !== true)
            throw new ToolError(
              'NEEDS_CONFIRMATION',
              'The customer has not confirmed this booking',
            );
          const c = await resolveCustomer(p, ctx.principal, undefined);
          // Idempotent twice over: the AI action record and the booking's own idempotency key.
          const booking = await this.flights.createBooking(
            c.id,
            String(input.offerId),
            [{ type: 'ADULT' }] as never,
            undefined,
            `ai-${ctx.idempotencyKey}`,
            Number(input.expectedPrice),
          );
          return res(
            {
              bookingReference: booking.bookingReference,
              status: booking.status,
              total: money(booking.totalAmount, booking.currency),
              nextStep: 'Pay the invoice to proceed to ticketing.',
            },
            ['ERP flight booking'],
            `Prepared booking ${booking.bookingReference}`,
            { resourceType: 'FlightBooking', resourceId: booking.id },
          );
        },
      },
      {
        key: 'sendNotification',
        description:
          'Sends a notification (email, SMS or push) to a customer through the notification engine, honouring their preferences and the company communication policy.',
        risk: AiRiskLevel.MEDIUM_RISK,
        audiences: ['STAFF', 'OPERATIONS', 'SYSTEM'],
        requiredPermissions: [PERMISSIONS.CRM.TASK_MANAGE],
        writes: true,
        idempotencyWindow: 'day',
        input: {
          customerId: S('Customer', { required: true }),
          channel: S('EMAIL, SMS or PUSH', {
            required: true,
            enum: ['EMAIL', 'SMS', 'PUSH'],
          }),
          subject: S('Subject', { required: true, maxLength: 120 }),
          body: S('Message', { required: true, maxLength: 1500 }),
        },
        preview: (i) => ({
          action: `Send a ${String(i.channel)} message to a customer`,
          risks: ['A customer receives it; it cannot be recalled'],
          whatWillHappen: [
            `Subject: ${String(i.subject)}`,
            'Sent through the notification engine, subject to preferences and policy',
          ],
          requiredApproval: 'Staff approval (autonomy below level 4)',
        }),
        execute: async (ctx, input) => {
          const c = await resolveCustomer(p, ctx.principal, input.customerId);
          const row = await p.customer.findUnique({
            where: { id: c.id },
            select: {
              identity: { select: { id: true, email: true, phone: true } },
            },
          });
          const channel = input.channel as 'EMAIL' | 'SMS' | 'PUSH';
          const to =
            channel === 'EMAIL'
              ? row?.identity.email
              : channel === 'SMS'
                ? row?.identity.phone
                : undefined;
          const r = await this.notifications.sendWorkflowMessage({
            channel,
            to,
            identityId: row?.identity.id,
            subject: String(input.subject),
            body: String(input.body),
            idempotencyKey: `ai:${ctx.idempotencyKey}`,
          });
          if (!r.sent && r.reason !== 'already_sent')
            throw new ToolError(
              'UNAVAILABLE',
              `Not sent: ${r.reason ?? 'unknown reason'}`,
            );
          return res(
            { sent: r.sent, alreadySent: r.reason === 'already_sent' },
            ['Notification engine'],
            `Sent a ${channel} message`,
            { resourceType: 'Customer', resourceId: c.id },
          );
        },
      },
    ];
  }

  // ------------------------------------------------------------------ high risk: always human approval
  private highRiskTools(): ToolDefinition[] {
    const p = this.prisma;
    const res = (
      data: Record<string, unknown>,
      summary: string,
      extra: Partial<ToolResult> = {},
    ): ToolResult => ({
      data: filterOutput(data),
      sources: ['ERP'],
      summary,
      ...extra,
    });
    const preview =
      (
        action: string,
        whatWillHappen: string[],
        risks: string[],
        approval: string,
        money?: ActionPreview['financialImpact'],
      ) =>
      (): ActionPreview => ({
        action,
        whatWillHappen,
        risks,
        requiredApproval: approval,
        financialImpact: money,
      });

    return [
      {
        key: 'cancelFlightBooking',
        description:
          'Requests cancellation of a reservation that has NOT been ticketed. Needs human approval.',
        risk: AiRiskLevel.HIGH_RISK,
        audiences: ['CUSTOMER', 'STAFF', 'OPERATIONS'],
        requiredPermissions: [],
        writes: true,
        executeOnApproval: true,
        input: {
          bookingReference: S('Booking reference', { required: true }),
          reason: S('Why', { maxLength: 500 }),
        },
        preview: preview(
          'Cancel a flight reservation',
          [
            'The provider order is cancelled',
            'The booking becomes CANCELLED',
            'The invoice is voided if unpaid',
          ],
          ['Fare may be lost', 'Cannot be undone'],
          'Staff approval',
        ),
        execute: async (ctx, input) => {
          const b = await p.flightBooking.findFirst({
            where: {
              bookingReference: String(input.bookingReference),
              customer: { companyId: ctx.principal.companyId ?? '__none__' },
            },
            select: { id: true, customerId: true, status: true },
          });
          if (!b) throw new ToolError('NOT_FOUND', 'Booking not found');
          if (b.status === FlightBookingStatus.TICKETED)
            throw new ToolError(
              'CONFLICT',
              'This booking is ticketed: use a refund request instead',
            );
          await this.flights.cancelBooking(b.id);
          return res(
            { cancelled: true },
            `Cancelled booking ${String(input.bookingReference)}`,
            { resourceType: 'FlightBooking', resourceId: b.id },
          );
        },
      },
      {
        key: 'requestFlightRefund',
        description:
          'Starts the refund process for a ticketed booking (creates the refund request that then goes through the normal refund approval). Needs human approval first.',
        risk: AiRiskLevel.HIGH_RISK,
        audiences: ['CUSTOMER', 'STAFF', 'OPERATIONS'],
        requiredPermissions: [],
        writes: true,
        executeOnApproval: true,
        input: {
          bookingReference: S('Booking reference', { required: true }),
          reason: S('Why', { required: true, maxLength: 500 }),
        },
        preview: preview(
          'Request a flight refund',
          [
            'A refund request is created for this booking',
            'It then follows the refund approval rules',
            'Agency fee and provider penalty may apply',
          ],
          ['Money leaves the business', 'Penalty reduces the refund'],
          'Finance/staff approval',
        ),
        execute: async (ctx, input) => {
          const b = await p.flightBooking.findFirst({
            where: {
              bookingReference: String(input.bookingReference),
              customer: { companyId: ctx.principal.companyId ?? '__none__' },
            },
            select: { id: true },
          });
          if (!b) throw new ToolError('NOT_FOUND', 'Booking not found');
          const r = await this.flightRefunds.requestRefund(b.id, {
            requestedByIdentityId: ctx.principal.identityId ?? '',
            requestedByStaffId: ctx.principal.staffId ?? undefined,
            requestedByCustomer: ctx.principal.kind === 'CUSTOMER',
            reason: asStr(input.reason),
          });
          return res(
            { refundRequestId: (r as { id?: string }).id ?? null },
            `Started a refund request for ${String(input.bookingReference)}`,
            { resourceType: 'FlightBooking', resourceId: b.id },
          );
        },
      },
      {
        key: 'issueFlightTicket',
        description:
          'Issues the ticket for a paid reservation. Needs human approval.',
        risk: AiRiskLevel.HIGH_RISK,
        audiences: ['STAFF', 'OPERATIONS'],
        requiredPermissions: [PERMISSIONS.FLIGHT.TICKET_ISSUE],
        writes: true,
        executeOnApproval: true,
        input: { bookingReference: S('Booking reference', { required: true }) },
        preview: preview(
          'Issue a flight ticket',
          [
            'The ticket is issued with the provider',
            'The booking becomes TICKETED',
          ],
          ['Tickets are costly or impossible to reverse'],
          'Staff approval',
        ),
        execute: async (ctx, input) => {
          if (!ctx.principal.staffId)
            throw new ToolError(
              'FORBIDDEN',
              'Ticket issuance is done by a staff member',
            );
          const b = await p.flightBooking.findFirst({
            where: {
              bookingReference: String(input.bookingReference),
              customer: { companyId: ctx.principal.companyId ?? '__none__' },
            },
            select: { id: true },
          });
          if (!b) throw new ToolError('NOT_FOUND', 'Booking not found');
          await this.ticketing.issueTicket(b.id, ctx.principal.staffId);
          return res(
            { issued: true },
            `Issued ticket for ${String(input.bookingReference)}`,
            { resourceType: 'FlightBooking', resourceId: b.id },
          );
        },
      },
      // Proposal-only: approving records the decision, but a person performs the action in the normal screen, which
      // has its own step-up, locking and idempotency. The agent can never execute these.
      ...(
        [
          [
            'adjustWalletBalance',
            'Proposes a wallet balance adjustment for a customer.',
            PERMISSIONS.WALLET.ADJUST,
            'Adjust a wallet balance',
          ],
          [
            'executeStaffPayout',
            'Proposes paying out a staff incentive.',
            PERMISSIONS.VISA.PAYOUT_APPROVE,
            'Pay out an incentive',
          ],
          [
            'markPaymentVerified',
            'Proposes marking a manual payment as verified.',
            PERMISSIONS.PAYMENT.RECORD,
            'Verify a manual payment',
          ],
          [
            'postJournalEntry',
            'Proposes posting an accounting entry.',
            PERMISSIONS.FINANCE.LEDGER_VIEW,
            'Post an accounting entry',
          ],
          [
            'changeBankDetails',
            'Proposes a change to bank details.',
            PERMISSIONS.FINANCE.STAFF_BANK_VERIFY,
            'Change bank details',
          ],
        ] as const
      ).map(([key, description, perm, action]): ToolDefinition => ({
        key,
        description: `${description} The agent can only PROPOSE: a person carries it out in the normal screen.`,
        risk: AiRiskLevel.HIGH_RISK,
        audiences: ['STAFF', 'OPERATIONS', 'EXECUTIVE', 'SYSTEM'],
        requiredPermissions: [perm],
        writes: true,
        executeOnApproval: false,
        input: {
          subjectId: S('What it concerns', { required: true }),
          amount: N('Amount', { min: 0 }),
          reason: S('Why', { required: true, maxLength: 800 }),
        },
        preview: preview(
          action,
          [
            'Nothing changes automatically',
            'The approver is told to do it in the normal screen',
          ],
          ['Financial/security control'],
          'Finance approval',
        ),
        execute: () =>
          Promise.resolve(
            res(
              { proposed: true },
              `${action}: proposal recorded (not executed by AI)`,
            ),
          ),
      })),
    ];
  }
}
