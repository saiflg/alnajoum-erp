import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** Spec #23 (role-based dashboards) / #24 (per-package profitability, financial-users-only). */
@Injectable()
export class HajjOpsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
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
      this.prisma.hajjGroup.groupBy({ by: ['status'], _count: true }),
      this.prisma.umrahGroup.groupBy({ by: ['status'], _count: true }),
      this.prisma.hajjGroup.count({
        where: { departureDate: { gte: new Date(), lte: soon } },
      }),
      this.prisma.umrahGroup.count({
        where: { departureDate: { gte: new Date(), lte: soon } },
      }),
      this.prisma.pilgrimCheckIn.count({
        where: { createdAt: { gte: todayStart } },
      }),
      this.prisma.vehicle.count({ where: { status: 'AVAILABLE' } }),
      this.prisma.driver.count({ where: { status: 'ACTIVE' } }),
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

  /** Spec #24 — never exposed to a role without HAJJ_OPS.PROFITABILITY_VIEW (enforced at the controller). */
  async hajjPackageProfitability(packageId: string) {
    const pkg = await this.prisma.hajjPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new NotFoundException('Hajj package not found');

    const registrations = await this.prisma.hajjRegistration.findMany({
      where: { packageId },
      include: { pilgrims: true, invoice: { include: { payments: true } } },
    });

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

  async umrahPackageProfitability(packageId: string) {
    const pkg = await this.prisma.umrahPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg) throw new NotFoundException('Umrah package not found');

    const registrations = await this.prisma.umrahRegistration.findMany({
      where: { packageId },
      include: { pilgrims: true, invoice: { include: { payments: true } } },
    });

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
