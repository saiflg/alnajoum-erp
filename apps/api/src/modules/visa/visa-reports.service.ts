import { Injectable } from '@nestjs/common';
import {
  IncentiveStatus,
  VisaApplicationStatus,
  VisaType,
} from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnalyticsScopeService,
  customerTenant,
  ReportScope,
  staffTenant,
} from '../analytics/analytics-scope.service';

export interface VisaProfitRow {
  applicationId: string;
  applicationReference: string;
  customer: string;
  visaType: string;
  destinationCountry: string;
  companyCost: number;
  sellingPrice: number;
  margin: number;
  staffIncentive: number;
  companyShare: number;
  otherFees: number;
  netProfit: number;
  paymentStatus: string;
  applicationStatus: VisaApplicationStatus;
  staff: string | null;
  branch: string | null;
  date: Date;
  currency: string;
}

/**
 * Spec #17 (per-application profit report) and #19 (dashboard KPIs).
 * Deliberately reads everything through Prisma queries scoped to
 * VisaApplication/StaffIncentive rather than a materialized reporting
 * table — this system has no data-warehouse layer, and application volume
 * here doesn't yet justify one.
 */
@Injectable()
export class VisaReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: AnalyticsScopeService,
  ) {}

  /**
   * The tenant comes from the caller's token, never from the request. A branch
   * the caller asks for must belong to their company (404 otherwise) and a
   * branch-locked caller (branch manager) is held to their own branch; a staff
   * filter must be someone in that same scope. (`customerId` on the status
   * breakdown needs no lookup: it is ANDed with the tenant filter, so another
   * company's customer simply matches nothing.)
   */
  private async scopeFor(
    user: AuthContext,
    filters: { branchId?: string; staffId?: string },
  ): Promise<ReportScope> {
    const scope = await this.scopes.resolve(user, filters.branchId);
    if (filters.staffId) {
      await this.scopes.assertStaffInScope(scope, filters.staffId);
    }
    return scope;
  }

  async profitReport(
    user: AuthContext,
    filters: {
      from?: Date;
      to?: Date;
      branchId?: string;
      staffId?: string;
      country?: string;
    },
  ): Promise<VisaProfitRow[]> {
    const scope = await this.scopeFor(user, filters);
    const applications = await this.prisma.visaApplication.findMany({
      where: {
        ...customerTenant(scope),
        createdAt: { gte: filters.from, lte: filters.to },
        destinationCountry: filters.country,
        OR: filters.staffId
          ? [
              { appliedByStaffId: filters.staffId },
              { assignedStaffId: filters.staffId },
            ]
          : undefined,
      },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        invoice: { include: { payments: true } },
        appliedByStaff: {
          select: {
            firstName: true,
            lastName: true,
            branchId: true,
            branch: { select: { name: true } },
          },
        },
        assignedStaff: {
          select: {
            firstName: true,
            lastName: true,
            branchId: true,
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const filtered = scope.branchId
      ? applications.filter(
          (a) =>
            a.appliedByStaff?.branchId === scope.branchId ||
            a.assignedStaff?.branchId === scope.branchId,
        )
      : applications;

    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType: 'VISA_APPLICATION',
        sourceId: { in: filtered.map((a) => a.id) },
        ...staffTenant(scope),
      },
    });
    const incentiveByApplication = new Map(
      incentives.map((i) => [i.sourceId, i]),
    );

    return filtered.map((app) => {
      const companyCost = app.companyCostSnapshot ?? 0;
      const sellingPrice = app.sellingPriceSnapshot ?? 0;
      const margin =
        app.companyCostSnapshot != null ? sellingPrice - companyCost : 0;
      const incentive = incentiveByApplication.get(app.id);
      const staffIncentive = incentive ? incentive.amount : 0;
      const companyShare = margin - staffIncentive;
      const staff = app.assignedStaff ?? app.appliedByStaff;
      const paid =
        app.invoice?.payments.reduce((sum, p) => sum + p.amount, 0) ?? 0;

      return {
        applicationId: app.id,
        applicationReference: app.applicationReference,
        customer: `${app.customer.firstName} ${app.customer.lastName}`,
        visaType: app.visaType,
        destinationCountry: app.destinationCountry,
        companyCost,
        sellingPrice,
        margin,
        staffIncentive,
        companyShare,
        otherFees: Math.max(0, app.totalAmount - sellingPrice),
        netProfit: margin - staffIncentive,
        paymentStatus: app.invoice
          ? app.invoice.status
          : paid > 0
            ? 'PARTIALLY_PAID'
            : 'UNPAID',
        applicationStatus: app.status,
        staff: staff ? `${staff.firstName} ${staff.lastName}` : null,
        branch: staff?.branch?.name ?? null,
        date: app.createdAt,
        currency: app.currency,
      };
    });
  }

  /**
   * KPIs for the admin dashboard. `groupBy` doesn't change the shape,
   * only which `filters` the caller is expected to have already narrowed
   * by (daily/weekly/monthly/annual/branch/staff/country/visa-type all
   * reduce to a from/to + branchId/staffId/country/visaType filter on the
   * same underlying query — see VisaReportsController for how the query
   * params map to this).
   */
  async kpis(
    user: AuthContext,
    filters: {
      from?: Date;
      to?: Date;
      branchId?: string;
      staffId?: string;
      country?: string;
      visaType?: VisaType;
    },
  ) {
    const scope = await this.scopeFor(user, filters);
    const applications = await this.prisma.visaApplication.findMany({
      where: {
        ...customerTenant(scope),
        createdAt: { gte: filters.from, lte: filters.to },
        destinationCountry: filters.country,
        visaType: filters.visaType,
        OR: filters.staffId
          ? [
              { appliedByStaffId: filters.staffId },
              { assignedStaffId: filters.staffId },
            ]
          : undefined,
      },
      include: {
        appliedByStaff: { select: { branchId: true } },
        assignedStaff: { select: { branchId: true } },
      },
    });

    const filtered = scope.branchId
      ? applications.filter(
          (a) =>
            a.appliedByStaff?.branchId === scope.branchId ||
            a.assignedStaff?.branchId === scope.branchId,
        )
      : applications;

    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType: 'VISA_APPLICATION',
        sourceId: { in: filtered.map((a) => a.id) },
        ...staffTenant(scope),
      },
    });

    const totalRevenue = filtered.reduce((sum, a) => sum + a.totalAmount, 0);
    const totalCost = filtered.reduce(
      (sum, a) => sum + (a.companyCostSnapshot ?? 0),
      0,
    );
    const totalMargin = filtered.reduce(
      (sum, a) =>
        sum +
        (a.companyCostSnapshot != null
          ? (a.sellingPriceSnapshot ?? 0) - a.companyCostSnapshot
          : 0),
      0,
    );
    const totalIncentives = incentives.reduce((sum, i) => sum + i.amount, 0);
    const pendingIncentives = incentives
      .filter((i) => i.status === IncentiveStatus.PENDING)
      .reduce((sum, i) => sum + i.amount, 0);

    const countByStatus = (status: VisaApplicationStatus) =>
      filtered.filter((a) => a.status === status).length;

    return {
      totalApplications: filtered.length,
      pendingApplications: countByStatus(VisaApplicationStatus.SUBMITTED),
      processing: filtered.filter((a) =>
        (
          [
            VisaApplicationStatus.UNDER_REVIEW,
            VisaApplicationStatus.SUBMITTED_TO_PROVIDER,
            VisaApplicationStatus.PROCESSING,
          ] as VisaApplicationStatus[]
        ).includes(a.status),
      ).length,
      approved: countByStatus(VisaApplicationStatus.APPROVED),
      rejected: countByStatus(VisaApplicationStatus.REJECTED),
      awaitingDocuments: countByStatus(
        VisaApplicationStatus.AWAITING_DOCUMENTS,
      ),
      awaitingGuarantor: countByStatus(
        VisaApplicationStatus.AWAITING_GUARANTOR,
      ),
      completed: countByStatus(VisaApplicationStatus.COMPLETED),
      revenue: totalRevenue,
      totalCost,
      totalMargin,
      staffIncentives: totalIncentives,
      pendingIncentives,
      netProfit: totalMargin - totalIncentives,
    };
  }

  /**
   * Spec #1's Visa Operations Center — the full per-status breakdown
   * (Total/New/Draft/Documents Pending/... /Expired), returned as a
   * complete count for every VisaApplicationStatus value rather than a
   * curated subset, so no status is ever silently dropped from the
   * dashboard as the workflow evolves. Broader access than kpis()/
   * profitReport() (gated VISA.VIEW, not VISA.INCENTIVE_VIEW) since this
   * carries no cost/margin figures — Visa Manager and Staff roles (spec
   * #28) can see it too, not just Super Admin/Finance.
   */
  async statusBreakdown(
    user: AuthContext,
    filters: {
      from?: Date;
      to?: Date;
      branchId?: string;
      staffId?: string;
      country?: string;
      visaType?: VisaType;
      customerId?: string;
      status?: VisaApplicationStatus;
    },
  ): Promise<{
    total: number;
    byStatus: Record<VisaApplicationStatus, number>;
  }> {
    const scope = await this.scopeFor(user, filters);
    const applications = await this.prisma.visaApplication.findMany({
      where: {
        ...customerTenant(scope),
        createdAt: { gte: filters.from, lte: filters.to },
        destinationCountry: filters.country,
        visaType: filters.visaType,
        customerId: filters.customerId,
        status: filters.status,
        OR: filters.staffId
          ? [
              { appliedByStaffId: filters.staffId },
              { assignedStaffId: filters.staffId },
            ]
          : undefined,
      },
      select: {
        status: true,
        appliedByStaff: { select: { branchId: true } },
        assignedStaff: { select: { branchId: true } },
      },
    });

    const filtered = scope.branchId
      ? applications.filter(
          (a) =>
            a.appliedByStaff?.branchId === scope.branchId ||
            a.assignedStaff?.branchId === scope.branchId,
        )
      : applications;

    const byStatus = Object.fromEntries(
      Object.values(VisaApplicationStatus).map((status) => [status, 0]),
    ) as Record<VisaApplicationStatus, number>;
    for (const application of filtered) {
      byStatus[application.status]++;
    }

    return { total: filtered.length, byStatus };
  }
}
