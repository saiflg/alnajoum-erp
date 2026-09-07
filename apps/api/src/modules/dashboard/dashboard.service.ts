import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Phase 11 spec #45 — the executive admin dashboard. Every query here is
 * tenant-scoped the same way as everywhere else in this phase: models
 * with their own companyId (Customer, Staff, Branch, ApprovalRequest,
 * AuditLog) filter directly; models without one (FlightBooking,
 * FlightRefund, StaffIncentive, Payment/Invoice) filter through their
 * relation to a Customer or Staff, rather than this phase adding a
 * companyId column to every table in the system (see Customer's own doc
 * comment on why only the two root models needed one directly).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getKpis(tenantCompanyId?: string, range?: { from?: Date; to?: Date }) {
    const companyFilter =
      tenantCompanyId !== undefined ? { companyId: tenantCompanyId } : {};
    const customerCompanyFilter =
      tenantCompanyId !== undefined
        ? { customer: { companyId: tenantCompanyId } }
        : {};
    const dateFilter =
      range?.from || range?.to
        ? {
            createdAt: {
              ...(range.from && { gte: range.from }),
              ...(range.to && { lte: range.to }),
            },
          }
        : {};

    const [
      totalCustomers,
      activeStaff,
      branches,
      flightBookings,
      flightRevenue,
      pendingApprovals,
      pendingFlightRefunds,
      pendingIncentives,
      securityAlerts24h,
    ] = await Promise.all([
      this.prisma.customer.count({ where: companyFilter }),
      this.prisma.staff.count({ where: { ...companyFilter, isActive: true } }),
      this.prisma.branch.count({ where: companyFilter }),
      this.prisma.flightBooking.count({
        where: { ...customerCompanyFilter, ...dateFilter },
      }),
      this.prisma.flightBooking.aggregate({
        where: {
          ...customerCompanyFilter,
          ...dateFilter,
          status: { in: ['TICKETED', 'REISSUED'] },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.approvalRequest.count({
        where: {
          ...companyFilter,
          status: { in: ['REQUESTED', 'UNDER_REVIEW'] },
        },
      }),
      this.prisma.flightRefund.count({
        where: {
          status: 'REQUESTED',
          booking:
            tenantCompanyId !== undefined
              ? { customer: { companyId: tenantCompanyId } }
              : undefined,
        },
      }),
      this.prisma.staffIncentive.count({
        where: {
          status: { in: ['PENDING', 'APPROVED'] },
          ...(tenantCompanyId !== undefined && {
            staff: { companyId: tenantCompanyId },
          }),
        },
      }),
      this.prisma.auditLog.count({
        where: {
          ...companyFilter,
          action: { startsWith: 'security.' },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      totalCustomers,
      activeStaff,
      branches,
      flightBookings,
      flightRevenue: flightRevenue._sum?.totalAmount ?? 0,
      pendingApprovals,
      pendingFlightRefunds,
      pendingIncentives,
      securityAlerts24h,
      generatedAt: new Date(),
    };
  }

  /**
   * Spec #44 — a single search box across the entities most staff
   * actually need to jump to. Every branch is tenant-scoped the same way
   * as its own module's list endpoint would be; this does NOT re-check
   * the caller's per-module permission (e.g. CUSTOMER.READ) before
   * including a result type — see this method's controller for why that
   * check happens there instead, once, rather than duplicated per branch
   * here.
   */
  async globalSearch(query: string, tenantCompanyId?: string) {
    const companyFilter =
      tenantCompanyId !== undefined ? { companyId: tenantCompanyId } : {};
    const q = query.trim();
    if (q.length < 2) {
      return { customers: [], flightBookings: [], staff: [], suppliers: [] };
    }

    const [customers, flightBookings, staff, suppliers] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          ...companyFilter,
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { passportNumber: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, firstName: true, lastName: true },
        take: 10,
      }),
      this.prisma.flightBooking.findMany({
        where: {
          ...(tenantCompanyId !== undefined && {
            customer: { companyId: tenantCompanyId },
          }),
          OR: [
            { bookingReference: { contains: q, mode: 'insensitive' } },
            { pnr: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, bookingReference: true, pnr: true, status: true },
        take: 10,
      }),
      this.prisma.staff.findMany({
        where: {
          ...companyFilter,
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { employeeCode: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          employeeCode: true,
        },
        take: 10,
      }),
      this.prisma.flightSupplier.findMany({
        where: { name: { contains: q, mode: 'insensitive' } },
        select: { id: true, name: true, type: true },
        take: 10,
      }),
    ]);

    return { customers, flightBookings, staff, suppliers };
  }
}
