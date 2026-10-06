import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/interfaces/auth-context.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnalyticsScopeService,
  customerTenant,
} from '../analytics/analytics-scope.service';

/**
 * A group has no companyId of its own; it belongs to a company through the
 * customers registered into it (or, for a group nobody has joined yet, through
 * its coordinator). A group with neither is unattributable and therefore
 * excluded from every tenant-scoped view, same conservative choice as leads.
 */
const hajjGroupTenant = (companyId?: string): Prisma.HajjGroupWhereInput =>
  companyId
    ? {
        OR: [
          { pilgrims: { some: { registration: { customer: { companyId } } } } },
          { coordinatorStaff: { companyId } },
        ],
      }
    : {};

const umrahGroupTenant = (companyId?: string): Prisma.UmrahGroupWhereInput =>
  companyId
    ? {
        OR: [
          { pilgrims: { some: { registration: { customer: { companyId } } } } },
          { coordinatorStaff: { companyId } },
        ],
      }
    : {};

/**
 * Fleet vehicles and drivers have no owner at all. A tenant sees only those its
 * own groups' transports actually use; SUPER_ADMIN sees the whole pool.
 */
const fleetTenant = (companyId?: string) =>
  companyId
    ? {
        transports: {
          some: {
            OR: [
              { hajjGroup: hajjGroupTenant(companyId) },
              { umrahGroup: umrahGroupTenant(companyId) },
            ],
          },
        },
      }
    : {};

/** Spec #23 (role-based dashboards) / #24 (per-package profitability, financial-users-only). */
@Injectable()
export class HajjOpsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: AnalyticsScopeService,
  ) {}

  /**
   * Check-ins carry a polymorphic `pilgrimId` (no foreign key) and an optional
   * staff id, so the tenant can only be established by joining the pilgrim to
   * its registration's customer. Done in SQL so no id list is ever shipped.
   */
  private async checkInsToday(
    companyId: string | undefined,
    todayStart: Date,
  ): Promise<number> {
    if (!companyId) {
      return this.prisma.pilgrimCheckIn.count({
        where: { createdAt: { gte: todayStart } },
      });
    }
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint | number }>>`
      SELECT COUNT(*) AS n FROM "pilgrim_check_ins" pc
      WHERE pc."createdAt" >= ${todayStart}
        AND (
          (pc."pilgrimType"::text = 'HAJJ' AND EXISTS (
            SELECT 1 FROM "hajj_registration_pilgrims" p
            JOIN "hajj_registrations" r ON r."id" = p."registrationId"
            JOIN "customers" c ON c."id" = r."customerId"
            WHERE p."id" = pc."pilgrimId" AND c."companyId" = ${companyId}))
          OR
          (pc."pilgrimType"::text = 'UMRAH' AND EXISTS (
            SELECT 1 FROM "umrah_registration_pilgrims" p
            JOIN "umrah_registrations" r ON r."id" = p."registrationId"
            JOIN "customers" c ON c."id" = r."customerId"
            WHERE p."id" = pc."pilgrimId" AND c."companyId" = ${companyId}))
        )`;
    return Number(rows[0]?.n ?? 0);
  }

  async dashboard(user: AuthContext) {
    const companyId = this.scopes.tenantOf(user);
    const soon = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      hajjGroupsByStatus,
      umrahGroupsByStatus,
      upcomingHajjDepartures,
      upcomingUmrahDepartures,
      checkInsToday,
      vehiclesAvailable,
      driversActive,
    ] = await Promise.all([
      this.prisma.hajjGroup.groupBy({
        by: ['status'],
        where: hajjGroupTenant(companyId),
        _count: true,
      }),
      this.prisma.umrahGroup.groupBy({
        by: ['status'],
        where: umrahGroupTenant(companyId),
        _count: true,
      }),
      this.prisma.hajjGroup.count({
        where: {
          ...hajjGroupTenant(companyId),
          departureDate: { gte: new Date(), lte: soon },
        },
      }),
      this.prisma.umrahGroup.count({
        where: {
          ...umrahGroupTenant(companyId),
          departureDate: { gte: new Date(), lte: soon },
        },
      }),
      this.checkInsToday(companyId, todayStart),
      this.prisma.vehicle.count({
        where: { status: 'AVAILABLE', ...fleetTenant(companyId) },
      }),
      this.prisma.driver.count({
        where: { status: 'ACTIVE', ...fleetTenant(companyId) },
      }),
    ]);

    return {
      hajjGroupsByStatus,
      umrahGroupsByStatus,
      upcomingHajjDepartures,
      upcomingUmrahDepartures,
      checkInsToday,
      vehiclesAvailable,
      driversActive,
    };
  }

  /**
   * Packages are a shared platform catalog with no owner, so what is tenant
   * specific here is the registrations: only the caller's own company's are
   * counted. A package whose registrations all belong to OTHER companies is not
   * the caller's business and is a 404, exactly like an unknown id (a package
   * nobody has registered for yet is shown as zeros).
   */
  private async assertPackageHasNoOnlyForeignRegistrations(
    companyId: string | undefined,
    kind: 'hajj' | 'umrah',
    packageId: string,
    ownRegistrations: number,
  ): Promise<void> {
    if (!companyId || ownRegistrations > 0) return;
    const where = { packageId };
    const any =
      kind === 'hajj'
        ? await this.prisma.hajjRegistration.count({ where })
        : await this.prisma.umrahRegistration.count({ where });
    if (any > 0) {
      throw new NotFoundException(
        kind === 'hajj' ? 'Hajj package not found' : 'Umrah package not found',
      );
    }
  }

  /** Spec #24 — never exposed to a role without HAJJ_OPS.PROFITABILITY_VIEW (enforced at the controller). */
  async hajjPackageProfitability(user: AuthContext, packageId: string) {
    const scope = this.scopes.tenantScope(user);
    const pkg = await this.prisma.hajjPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new NotFoundException('Hajj package not found');

    const registrations = await this.prisma.hajjRegistration.findMany({
      where: { packageId, ...customerTenant(scope) },
      include: { pilgrims: true, invoice: { include: { payments: true } } },
    });
    await this.assertPackageHasNoOnlyForeignRegistrations(
      scope.companyId,
      'hajj',
      packageId,
      registrations.length,
    );

    const pilgrimCount = registrations.reduce(
      (s, r) => s + r.pilgrims.length,
      0,
    );
    const revenueCollected = registrations.reduce(
      (s, r) =>
        s + (r.invoice?.payments.reduce((ps, p) => ps + p.amount, 0) ?? 0),
      0,
    );
    const revenueBilled = registrations.reduce((s, r) => s + r.totalAmount, 0);
    const estimatedCost = (pkg.internalCost ?? 0) * pilgrimCount;

    return {
      packageId,
      packageName: pkg.name,
      currency: pkg.currency,
      pilgrimCount,
      revenueBilled,
      revenueCollected,
      estimatedCost,
      estimatedMargin: revenueBilled - estimatedCost,
    };
  }

  async umrahPackageProfitability(user: AuthContext, packageId: string) {
    const scope = this.scopes.tenantScope(user);
    const pkg = await this.prisma.umrahPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new NotFoundException('Umrah package not found');

    const registrations = await this.prisma.umrahRegistration.findMany({
      where: { packageId, ...customerTenant(scope) },
      include: { pilgrims: true, invoice: { include: { payments: true } } },
    });
    await this.assertPackageHasNoOnlyForeignRegistrations(
      scope.companyId,
      'umrah',
      packageId,
      registrations.length,
    );

    const pilgrimCount = registrations.reduce(
      (s, r) => s + r.pilgrims.length,
      0,
    );
    const revenueCollected = registrations.reduce(
      (s, r) =>
        s + (r.invoice?.payments.reduce((ps, p) => ps + p.amount, 0) ?? 0),
      0,
    );
    const revenueBilled = registrations.reduce((s, r) => s + r.totalAmount, 0);
    const estimatedCost = pkg.costPrice * pilgrimCount;

    return {
      packageId,
      packageName: pkg.name,
      currency: pkg.currency,
      pilgrimCount,
      revenueBilled,
      revenueCollected,
      estimatedCost,
      estimatedMargin: revenueBilled - estimatedCost,
    };
  }
}
