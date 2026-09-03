import { Injectable } from '@nestjs/common';
import {
  IncentiveStatus,
  VisaApplicationStatus,
  VisaType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async profitReport(filters: {
    from?: Date;
    to?: Date;
    branchId?: string;
    staffId?: string;
    country?: string;
  }): Promise<VisaProfitRow[]> {
    const applications = await this.prisma.visaApplication.findMany({
      where: {
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

    const filtered = filters.branchId
      ? applications.filter(
          (a) =>
            a.appliedByStaff?.branchId === filters.branchId ||
            a.assignedStaff?.branchId === filters.branchId,
        )
      : applications;

    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType: 'VISA_APPLICATION',
        sourceId: { in: filtered.map((a) => a.id) },
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
  async kpis(filters: {
    from?: Date;
    to?: Date;
    branchId?: string;
    staffId?: string;
    country?: string;
    visaType?: VisaType;
  }) {
    const applications = await this.prisma.visaApplication.findMany({
      where: {
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

    const filtered = filters.branchId
      ? applications.filter(
          (a) =>
            a.appliedByStaff?.branchId === filters.branchId ||
            a.assignedStaff?.branchId === filters.branchId,
        )
      : applications;

    const incentives = await this.prisma.staffIncentive.findMany({
      where: {
        sourceType: 'VISA_APPLICATION',
        sourceId: { in: filtered.map((a) => a.id) },
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
}
