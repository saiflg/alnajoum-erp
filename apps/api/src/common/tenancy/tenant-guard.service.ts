import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Tenant ownership checks by entity kind (Phase 22 S-12).
 *
 * Reads were tenant-scoped in Phase 11; the by-id writes and several sub-resource reads were not, so
 * a company admin could cancel, ticket, approve or read another company's records by guessing an id.
 * This service is the one place that knows how each record reaches its company, so a controller (or
 * service) can state its precondition in one line:
 *
 *   await this.tenantGuard.assert('flightBooking', id, resolveTenantFilter(user));
 *
 * `tenant === undefined` (a SUPER_ADMIN) is allowed through. For anyone else a record of another
 * company is indistinguishable from a missing one: NotFoundException, never Forbidden, so the
 * response does not reveal that the id exists.
 *
 * Reaching a company:
 *  - most records through their customer (`customer.companyId`);
 *  - staff-created records through the creating/assigned staff member (`staff.companyId`);
 *  - invoices through whichever of those applies.
 */
type Where = Record<string, unknown>;

interface Scope {
  model: string;
  /** The extra `where` that confines the record to company `c`. */
  scope: (c: string) => Where;
}

const viaCustomer = (model: string): Scope => ({
  model,
  scope: (c) => ({ customer: { companyId: c } }),
});

export const TENANT_SCOPES = {
  customer: { model: 'customer', scope: (c: string) => ({ companyId: c }) },
  staff: { model: 'staff', scope: (c: string) => ({ companyId: c }) },
  branch: { model: 'branch', scope: (c: string) => ({ companyId: c }) },
  flightBooking: viaCustomer('flightBooking'),
  hotelBooking: viaCustomer('hotelBooking'),
  visaApplication: viaCustomer('visaApplication'),
  vehicleRental: viaCustomer('vehicleRental'),
  supportTicket: viaCustomer('supportTicket'),
  hajjRegistration: viaCustomer('hajjRegistration'),
  umrahRegistration: viaCustomer('umrahRegistration'),
  customerDocument: viaCustomer('customerDocument'),
  familyMember: viaCustomer('familyMember'),
  travelPackage: viaCustomer('travelPackage'),
  paymentIntent: viaCustomer('paymentIntent'),
  // Records that hang off a booking/application: they belong to whoever the parent belongs to.
  flightRefund: {
    model: 'flightRefund',
    scope: (c: string) => ({ booking: { customer: { companyId: c } } }),
  },
  flightReissue: {
    model: 'flightReissue',
    scope: (c: string) => ({ booking: { customer: { companyId: c } } }),
  },
  flightVoid: {
    model: 'flightVoid',
    scope: (c: string) => ({ booking: { customer: { companyId: c } } }),
  },
  hotelRefund: {
    model: 'hotelRefund',
    scope: (c: string) => ({ booking: { customer: { companyId: c } } }),
  },
  visaRefund: {
    model: 'visaRefund',
    scope: (c: string) => ({ application: { customer: { companyId: c } } }),
  },
  visaNote: {
    model: 'visaApplicationNote',
    scope: (c: string) => ({ application: { customer: { companyId: c } } }),
  },
  visaSubmission: {
    model: 'visaSubmission',
    scope: (c: string) => ({ application: { customer: { companyId: c } } }),
  },
  customerFeedback: viaCustomer('customerFeedback'),
  guarantor: {
    model: 'guarantor',
    scope: (c: string) => ({ application: { customer: { companyId: c } } }),
  },
  flightGroupBooking: {
    model: 'flightGroupBooking',
    scope: (c: string) => ({
      OR: [
        { branch: { companyId: c } },
        { createdByStaff: { companyId: c } },
        { invoice: { customer: { companyId: c } } },
      ],
    }),
  },
  hajjGroup: { model: 'hajjGroup', scope: (c: string) => ({ companyId: c }) },
  umrahGroup: { model: 'umrahGroup', scope: (c: string) => ({ companyId: c }) },
  vehicle: { model: 'vehicle', scope: (c: string) => ({ companyId: c }) },
  driver: { model: 'driver', scope: (c: string) => ({ companyId: c }) },
  transport: { model: 'transport', scope: (c: string) => ({ companyId: c }) },
  roomAllocation: {
    model: 'roomAllocation',
    scope: (c: string) => ({ companyId: c }),
  },
  hajjRegistrationPilgrim: {
    model: 'hajjRegistrationPilgrim',
    scope: (c: string) => ({ registration: { customer: { companyId: c } } }),
  },
  umrahRegistrationPilgrim: {
    model: 'umrahRegistrationPilgrim',
    scope: (c: string) => ({ registration: { customer: { companyId: c } } }),
  },
  payment: {
    model: 'payment',
    scope: (c: string) => ({
      invoice: {
        OR: [
          { customer: { companyId: c } },
          { issuedByStaff: { companyId: c } },
          { corporateBooking: { corporateAccount: { companyId: c } } },
        ],
      },
    }),
  },
  referral: {
    model: 'referral',
    scope: (c: string) => ({ referredCustomer: { companyId: c } }),
  },
  staffIncentive: {
    model: 'staffIncentive',
    scope: (c: string) => ({ staff: { companyId: c } }),
  },
  staffPayout: {
    model: 'staffPayout',
    scope: (c: string) => ({ staff: { companyId: c } }),
  },
  expense: {
    model: 'expense',
    scope: (c: string) => ({ createdByStaff: { companyId: c } }),
  },
  campaign: {
    model: 'campaign',
    scope: (c: string) => ({ createdByStaff: { companyId: c } }),
  },
  corporateBooking: {
    model: 'corporateBooking',
    scope: (c: string) => ({ corporateAccount: { companyId: c } }),
  },
  corporateAccount: {
    model: 'corporateAccount',
    scope: (c: string) => ({ companyId: c }),
  },
  lead: {
    model: 'lead',
    scope: (c: string) => ({
      OR: [
        { assignedBranch: { companyId: c } },
        { assignedStaff: { companyId: c } },
        { createdByStaff: { companyId: c } },
      ],
    }),
  },
  // Phase 26 - identification cards and the communication centre all carry their own companyId.
  staffIdCard: {
    model: 'staffIdCard',
    scope: (c: string) => ({ companyId: c }),
  },
  commContact: {
    model: 'commContact',
    scope: (c: string) => ({ companyId: c }),
  },
  commSegment: {
    model: 'commSegment',
    scope: (c: string) => ({ companyId: c }),
  },
  commTemplate: {
    model: 'commTemplate',
    scope: (c: string) => ({ companyId: c }),
  },
  commCampaign: {
    model: 'commCampaign',
    scope: (c: string) => ({ companyId: c }),
  },
  commSuppression: {
    model: 'commSuppression',
    scope: (c: string) => ({ companyId: c }),
  },
  invoice: {
    model: 'invoice',
    scope: (c: string) => ({
      OR: [
        { customer: { companyId: c } },
        { issuedByStaff: { companyId: c } },
        { corporateBooking: { corporateAccount: { companyId: c } } },
      ],
    }),
  },
} as const satisfies Record<string, Scope>;

export type TenantKind = keyof typeof TENANT_SCOPES;

@Injectable()
export class TenantGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /** The Prisma `where` fragment that confines `kind` to `tenant` (empty for SUPER_ADMIN). */
  scopeOf(kind: TenantKind, tenant: string | undefined): Where {
    return tenant === undefined ? {} : TENANT_SCOPES[kind].scope(tenant);
  }

  async assert(
    kind: TenantKind,
    id: string,
    tenant: string | undefined,
  ): Promise<void> {
    if (tenant === undefined) return;
    const { model, scope } = TENANT_SCOPES[kind];
    const delegate = (
      this.prisma as unknown as Record<
        string,
        { findFirst: (a: unknown) => Promise<unknown> }
      >
    )[model];
    const found = await delegate.findFirst({
      where: { id, ...scope(tenant) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`${label(kind)} not found`);
  }

  /** Asserts every id; used for bodies that name several records (e.g. a transfer between two customers). */
  async assertAll(
    checks: Array<[TenantKind, string | undefined | null]>,
    tenant: string | undefined,
  ): Promise<void> {
    for (const [kind, id] of checks) {
      if (id) await this.assert(kind, id, tenant);
    }
  }
}

function label(kind: TenantKind): string {
  return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/**
 * The `where` fragment that confines `kind` to `tenant`, for list queries: `{}` for a SUPER_ADMIN
 * (tenant undefined). Typed loosely on purpose - it is spread into Prisma `where` objects of the
 * model the kind names.
 */

export function tenantWhere(
  kind: TenantKind,
  tenant: string | undefined,
): Record<string, any> {
  return tenant === undefined ? {} : TENANT_SCOPES[kind].scope(tenant);
}
