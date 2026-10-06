import { Injectable } from '@nestjs/common';
import { LeadStatus, Prisma, TaskStatus, TicketStatus } from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnalyticsScopeService,
  customerTenant,
  NO_BRANCH,
  ReportScope,
  staffTenant,
} from '../analytics/analytics-scope.service';

interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Lead has no companyId; like LeadsService it is tied to a tenant through its
 * assigned branch, and — more inclusive, still provably the same tenant —
 * through its assigned staff member. A fresh, unassigned lead is unattributable
 * and so is left out of every tenant-scoped figure.
 */
const leadTenant = (
  scope: Pick<ReportScope, 'companyId'>,
): Prisma.LeadWhereInput =>
  scope.companyId
    ? {
        OR: [
          { assignedBranch: { companyId: scope.companyId } },
          { assignedStaff: { companyId: scope.companyId } },
        ],
      }
    : {};

/** Spec #26 (staff performance), #27 (customer value), #33 (role dashboards). */
@Injectable()
export class CrmReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: AnalyticsScopeService,
  ) {}

  private range(range: DateRange) {
    if (!range.from && !range.to) return {};
    return {
      createdAt: {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    };
  }

  /**
   * A staff id from the path must be someone in the caller's own tenant (and,
   * for a branch manager, their own branch) — otherwise a 404. `self` is the
   * caller's own record (the /me routes), which is in scope by construction and
   * must keep working for a staff member who has no branch.
   */
  private async staffScope(
    user: AuthContext,
    staffId: string,
    self: boolean,
  ): Promise<ReportScope> {
    const scope = self
      ? this.scopes.tenantScope(user)
      : await this.scopes.resolve(user);
    await this.scopes.assertStaffInScope(scope, staffId);
    return scope;
  }

  /** Spec #26 — explicitly informational; never wired to salary/discipline decisions (see doc comment). */
  async staffPerformance(
    user: AuthContext,
    staffId: string,
    range: DateRange = {},
    self = false,
  ) {
    const scope = await this.staffScope(user, staffId, self);
    const dateFilter = this.range(range);
    const [
      leadsAssigned,
      leadsContacted,
      leadsConverted,
      customersHandled,
      followUpsCompleted,
      ticketsResolved,
      bookingsCreated,
      visaApplications,
      hajjRegistrations,
      umrahRegistrations,
      incentivesEarned,
    ] = await Promise.all([
      this.prisma.lead.count({
        where: {
          assignedStaffId: staffId,
          ...leadTenant(scope),
          ...dateFilter,
        },
      }),
      this.prisma.leadActivity.count({
        where: {
          performedByStaffId: staffId,
          performedByStaff: scope.companyId
            ? { companyId: scope.companyId }
            : undefined,
          action: 'contacted',
          ...dateFilter,
        },
      }),
      this.prisma.lead.count({
        where: {
          assignedStaffId: staffId,
          status: LeadStatus.CONVERTED,
          ...leadTenant(scope),
          ...dateFilter,
        },
      }),
      this.prisma.customer.count({
        where: {
          assignedStaffId: staffId,
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
        },
      }),
      this.prisma.task.count({
        where: {
          assignedStaffId: staffId,
          assignedStaff: scope.companyId
            ? { companyId: scope.companyId }
            : undefined,
          relatedType: 'FOLLOW_UP',
          status: TaskStatus.COMPLETED,
          ...dateFilter,
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          assignedStaffId: staffId,
          ...customerTenant(scope),
          status: TicketStatus.RESOLVED,
          ...dateFilter,
        },
      }),
      this.prisma.flightBooking.count({
        where: {
          bookedByStaffId: staffId,
          ...customerTenant(scope),
          ...dateFilter,
        },
      }),
      this.prisma.visaApplication.count({
        where: {
          appliedByStaffId: staffId,
          ...customerTenant(scope),
          ...dateFilter,
        },
      }),
      this.prisma.hajjRegistration.count({
        where: {
          registeredByStaffId: staffId,
          ...customerTenant(scope),
          ...dateFilter,
        },
      }),
      this.prisma.umrahRegistration.count({
        where: {
          registeredByStaffId: staffId,
          ...customerTenant(scope),
          ...dateFilter,
        },
      }),
      this.prisma.staffIncentive.aggregate({
        where: { staffId, ...staffTenant(scope), ...dateFilter },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      leadsAssigned,
      leadsContacted,
      leadsConverted,
      conversionRate:
        leadsAssigned > 0
          ? Math.round((leadsConverted / leadsAssigned) * 100)
          : 0,
      customersHandled,
      followUpsCompleted,
      ticketsResolved,
      bookingsCreated,
      visaApplications,
      hajjRegistrations,
      umrahRegistrations,
      eligibleIncentives: {
        count: incentivesEarned._count,
        amount: incentivesEarned._sum.amount ?? 0,
      },
    };
  }

  /** Spec #27. */
  async customerValue(user: AuthContext, customerId: string) {
    const scope = this.scopes.tenantScope(user);
    await this.scopes.assertCustomerInScope(scope, customerId);
    const [invoices, lastPayment] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { customerId, ...customerTenant(scope) },
        include: { payments: true },
      }),
      this.prisma.payment.findFirst({
        where: { invoice: { customerId, ...customerTenant(scope) } },
        orderBy: { paidAt: 'desc' },
      }),
    ]);
    const bookingCounts = await Promise.all([
      this.prisma.flightBooking.count({
        where: { customerId, ...customerTenant(scope) },
      }),
      this.prisma.hotelBooking.count({
        where: { customerId, ...customerTenant(scope) },
      }),
      this.prisma.visaApplication.count({
        where: { customerId, ...customerTenant(scope) },
      }),
      this.prisma.hajjRegistration.count({
        where: { customerId, ...customerTenant(scope) },
      }),
      this.prisma.umrahRegistration.count({
        where: { customerId, ...customerTenant(scope) },
      }),
    ]);
    const totalSpending = invoices.reduce(
      (sum, inv) => sum + inv.payments.reduce((s, p) => s + p.amount, 0),
      0,
    );
    const numberOfServices = bookingCounts.reduce((a, b) => a + b, 0);

    return {
      totalSpending,
      numberOfBookings: invoices.length,
      numberOfServices,
      averageTransactionValue:
        invoices.length > 0 ? Math.round(totalSpending / invoices.length) : 0,
      lastTransactionAt: lastPayment?.paidAt ?? null,
      customerLifetimeValue: totalSpending,
    };
  }

  /** Spec #33 — Staff dashboard. */
  async staffDashboard(user: AuthContext, staffId: string, self = false) {
    const scope = await this.staffScope(user, staffId, self);
    const [myLeads, myTasks, upcomingTravel, pendingApplications, tickets] =
      await Promise.all([
        this.prisma.lead.count({
          where: {
            assignedStaffId: staffId,
            ...leadTenant(scope),
            status: LeadStatus.OPEN,
          },
        }),
        this.prisma.task.count({
          where: {
            assignedStaffId: staffId,
            assignedStaff: scope.companyId
              ? { companyId: scope.companyId }
              : undefined,
            status: {
              in: [
                TaskStatus.PENDING,
                TaskStatus.IN_PROGRESS,
                TaskStatus.OVERDUE,
              ],
            },
          },
        }),
        this.prisma.flightBooking.count({
          where: {
            bookedByStaffId: staffId,
            ...customerTenant(scope),
            departureAt: { gte: new Date() },
          },
        }),
        this.prisma.visaApplication.count({
          where: {
            appliedByStaffId: staffId,
            ...customerTenant(scope),
            status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED'] },
          },
        }),
        this.prisma.supportTicket.count({
          where: {
            assignedStaffId: staffId,
            ...customerTenant(scope),
            status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
          },
        }),
      ]);
    return {
      myLeads,
      myTasks,
      upcomingTravel,
      pendingApplications,
      openTickets: tickets,
    };
  }

  /** Spec #33 — Branch Manager dashboard. A branch outside the caller's company (or, for a branch manager, outside their own branch) is a 404. */
  async branchDashboard(user: AuthContext, requestedBranchId: string) {
    const scope = await this.scopes.resolve(user, requestedBranchId);
    const branchId = scope.branchId ?? NO_BRANCH;
    const [leads, converted, revenue, openTickets] = await Promise.all([
      this.prisma.lead.count({
        where: { assignedBranchId: branchId, ...leadTenant(scope) },
      }),
      this.prisma.lead.count({
        where: {
          assignedBranchId: branchId,
          ...leadTenant(scope),
          status: LeadStatus.CONVERTED,
        },
      }),
      this.prisma.flightBooking.aggregate({
        where: {
          branchId,
          ...customerTenant(scope),
          status: { notIn: ['CANCELLED', 'FAILED'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.supportTicket.count({
        where: {
          branchId,
          ...customerTenant(scope),
          status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        },
      }),
    ]);
    return {
      branchLeads: leads,
      conversionRate: leads > 0 ? Math.round((converted / leads) * 100) : 0,
      revenue: revenue._sum.totalAmount ?? 0,
      openTickets,
    };
  }

  /**
   * Spec #33 — Super Admin dashboard. Company-wide for the caller's own company
   * (no branch dimension, so no branch lock). Campaigns have no company or
   * branch either: they are attributed through the staff member who created
   * them, so a campaign with no recorded creator is counted for SUPER_ADMIN only.
   */
  async companyDashboard(user: AuthContext) {
    const scope = this.scopes.tenantScope(user);
    const companyId = scope.companyId;
    const campaignCreators = companyId
      ? {
          createdByStaffId: {
            in: (
              await this.prisma.staff.findMany({
                where: { companyId },
                select: { id: true },
              })
            ).map((s) => s.id),
          },
        }
      : {};
    const [
      totalCustomers,
      newLeads,
      totalLeads,
      convertedLeads,
      slaBreaches,
      openTickets,
      activeCampaigns,
    ] = await Promise.all([
      this.prisma.customer.count({
        where: companyId ? { companyId } : {},
      }),
      this.prisma.lead.count({
        where: {
          ...leadTenant(scope),
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.lead.count({ where: leadTenant(scope) }),
      this.prisma.lead.count({
        where: { ...leadTenant(scope), status: LeadStatus.CONVERTED },
      }),
      this.prisma.supportTicket.count({
        where: { ...customerTenant(scope), slaBreached: true },
      }),
      this.prisma.supportTicket.count({
        where: {
          ...customerTenant(scope),
          status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        },
      }),
      this.prisma.campaign.count({
        where: { status: 'ACTIVE', ...campaignCreators },
      }),
    ]);
    return {
      totalCustomers,
      newLeads,
      conversionRate:
        totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0,
      slaBreaches,
      openTickets,
      activeCampaigns,
    };
  }
}
