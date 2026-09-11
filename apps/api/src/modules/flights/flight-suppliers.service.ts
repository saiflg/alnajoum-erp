import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightSupplierDto } from './dto/create-flight-supplier.dto';
import { UpdateFlightSupplierDto } from './dto/update-flight-supplier.dto';

/** Spec #23's own worked example — an alert fires once utilization crosses this. */
const CREDIT_UTILIZATION_ALERT_THRESHOLD = 0.85;

export interface FlightSupplierBalance {
  totalPayable: number;
  totalPaid: number;
  currentBalance: number; // outstanding exposure — totalPayable minus totalPaid
  creditLimit: number | null;
  availableCredit: number | null;
  utilization: number | null; // 0-1, null when no credit limit is configured
  alert: string | null;
}

/**
 * Phase 10 spec #22/#23 — a supplier *master record* (contract terms,
 * credit limit, API status), distinct from the existing generic
 * SupplierPayable/SupplierPayment AP ledger (free-text-keyed, shared
 * across Flight/Hotel/Visa — see that model's own doc comment). Balance is
 * never a stored column, same discipline as Wallet: always computed live
 * from this supplier's linked SupplierPayable/SupplierPayment rows.
 *
 * Phase 11 spec #2/#65 fix — a supplier's negotiated commission/markup/
 * credit terms are commercially sensitive per-tenant data; every method
 * now takes an optional tenantCompanyId (undefined only for SUPER_ADMIN)
 * and scopes to it, same pattern as every other module in this phase's
 * cross-tenant sweep.
 */
@Injectable()
export class FlightSuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  listAll(filters: { status?: string } = {}, tenantCompanyId?: string) {
    return this.prisma.flightSupplier.findMany({
      where: {
        ...(filters.status && { status: filters.status as never }),
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateFlightSupplierDto, companyId: string) {
    return this.prisma.flightSupplier.create({ data: { ...dto, companyId } });
  }

  async get(id: string, tenantCompanyId?: string) {
    const supplier = await this.prisma.flightSupplier.findUnique({
      where: { id },
      include: { contracts: true },
    });
    if (
      !supplier ||
      (tenantCompanyId !== undefined && supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Flight supplier not found');
    }
    return supplier;
  }

  async update(
    id: string,
    dto: UpdateFlightSupplierDto,
    tenantCompanyId?: string,
  ) {
    await this.get(id, tenantCompanyId);
    return this.prisma.flightSupplier.update({ where: { id }, data: dto });
  }

  /**
   * Spec #23 — opening/deposits/bookings/refunds/adjustments all already
   * live on the linked SupplierPayable/SupplierPayment rows; this just
   * totals them rather than tracking a second, driftable balance.
   */
  async getBalance(
    id: string,
    tenantCompanyId?: string,
  ): Promise<FlightSupplierBalance> {
    const supplier = await this.get(id, tenantCompanyId);
    const payables = await this.prisma.supplierPayable.findMany({
      where: { flightSupplierId: id },
    });

    const totalPayable = payables.reduce((sum, p) => sum + p.amount, 0);
    const totalPaid = payables.reduce((sum, p) => sum + p.amountPaid, 0);
    const currentBalance = totalPayable - totalPaid;

    const creditLimit = supplier.creditLimit;
    const availableCredit =
      creditLimit != null ? creditLimit - currentBalance : null;
    const utilization =
      creditLimit != null && creditLimit > 0
        ? currentBalance / creditLimit
        : null;
    const alert =
      utilization != null && utilization >= CREDIT_UTILIZATION_ALERT_THRESHOLD
        ? `Supplier credit utilization is at ${Math.round(utilization * 100)}%, above the ${Math.round(CREDIT_UTILIZATION_ALERT_THRESHOLD * 100)}% alert threshold.`
        : null;

    return {
      totalPayable,
      totalPaid,
      currentBalance,
      creditLimit,
      availableCredit,
      utilization,
      alert,
    };
  }
}
