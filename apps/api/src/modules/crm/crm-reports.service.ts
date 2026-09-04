import { Injectable } from '@nestjs/common';
import { LeadStatus, TaskStatus, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface DateRange {
  from?: Date;
  to?: Date;
}

/** Spec #26 (staff performance), #27 (customer value), #33 (role dashboards). */
@Injectable()
export class CrmReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(range: DateRange) {
    if (!range.from && !range.to) return {};
    return {
      createdAt: {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    };
  }

  /** Spec #26 — explicitly informational; never wired to salary/discipline decisions (see doc comment). */
  async staffPerformance(staffId: string, range: DateRange = {}) {
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
        where: { assignedStaffId: staffId, ...dateFilter },
      }),
      this.prisma.leadActivity.count({
        where: {
          performedByStaffId: staffId,
          action: 'contacted',
          ...dateFilter,
        },
      }),
      this.prisma.lead.count({
        where: {
          assignedStaffId: staffId,
          status: LeadStatus.CONVERTED,
          ...dateFilter,
        },
      }),
      this.prisma.customer.count({ where: { assignedStaffId: staffId } }),
      this.prisma.task.count({
        where: {
          assignedStaffId: staffId,
          relatedType: 'FOLLOW_UP',
          status: TaskStatus.COMPLETED,
          ...dateFilter,
        },
      }),
      this.prisma.supportTicket.count({
        where: {
          assignedStaffId: staffId,
          status: TicketStatus.RESOLVED,
          ...dateFilter,
        },
      }),
      this.prisma.flightBooking.count({
        where: { bookedByStaffId: staffId, ...dateFilter },
      }),
      this.prisma.visaApplication.count({
        where: { appliedByStaffId: staffId, ...dateFilter },
      }),
      this.prisma.hajjRegistration.count({
        where: { registeredByStaffId: staffId, ...dateFilter },
      }),
      this.prisma.umrahRegistration.count({
        where: { registeredByStaffId: staffId, ...dateFilter },
      }),
      this.prisma.staffIncentive.aggregate({
        where: { staffId, ...dateFilter },
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
  async customerValue(customerId: string) {
    const [invoices, lastPayment] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { customerId },
        include: { payments: true },
      }),
      this.prisma.payment.findFirst({
        where: { invoice: { customerId } },
        orderBy: { paidAt: 'desc' },
      }),
    ]);
    const bookingCounts = await Promise.all([
      this.prisma.flightBooking.count({ where: { customerId } }),
      this.prisma.hotelBooking.count({ where: { customerId } }),
      this.prisma.visaApplication.count({ where: { customerId } }),
      this.prisma.hajjRegistration.count({ where: { customerId } }),
      this.prisma.umrahRegistration.count({ where: { customerId } }),
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
  async staffDashboard(staffId: string) {
    const [myLeads, myTasks, upcomingTravel, pendingApplications, tickets] =
      await Promise.all([
        this.prisma.lead.count({
          where: { assignedStaffId: staffId, status: LeadStatus.OPEN },
        }),
        this.prisma.task.count({
          where: {
            assignedStaffId: staffId,
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
          where: { bookedByStaffId: staffId, departureAt: { gte: new Date() } },
        }),
        this.prisma.visaApplication.count({
          where: {
            appliedByStaffId: staffId,
            status: { notIn: ['APPROVED', 'REJECTED', 'CANCELLED'] },
          },
        }),
        this.prisma.supportTicket.count({
          where: {
            assignedStaffId: staffId,
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

  /** Spec #33 — Branch Manager dashboard. */
  async branchDashboard(branchId: string) {
    const [leads, converted, revenue, openTickets] = await Promise.all([
      this.prisma.lead.count({ where: { assignedBranchId: branchId } }),
      this.prisma.lead.count({
        where: { assignedBranchId: branchId, status: LeadStatus.CONVERTED },
      }),
      this.prisma.flightBooking.aggregate({
        where: { branchId, status: { notIn: ['CANCELLED', 'FAILED'] } },
        _sum: { totalAmount: true },
      }),
      this.prisma.supportTicket.count({
        where: {
          branchId,
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

  /** Spec #33 — Super Admin dashboard. */
  async companyDashboard() {
    const [
      totalCustomers,
      newLeads,
      totalLeads,
      convertedLeads,
      slaBreaches,
      openTickets,
      activeCampaigns,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.lead.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.lead.count(),
      this.prisma.lead.count({ where: { status: LeadStatus.CONVERTED } }),
      this.prisma.supportTicket.count({ where: { slaBreached: true } }),
      this.prisma.supportTicket.count({
        where: {
          status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        },
      }),
      this.prisma.campaign.count({ where: { status: 'ACTIVE' } }),
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
