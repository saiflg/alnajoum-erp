import { Injectable, NotFoundException } from '@nestjs/common';
import { FlightSupplierContractStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateFlightSupplierContractDto } from './dto/create-flight-supplier-contract.dto';
import { UpdateFlightSupplierContractDto } from './dto/update-flight-supplier-contract.dto';

/** Spec #24 — "alert before contract expiry." A window, not a single day,
 * so an admin dashboard can surface "expiring soon" ahead of the deadline. */
const EXPIRY_ALERT_WINDOW_DAYS = 30;

/**
 * Phase 11 spec #2/#65 fix — a contract has no companyId of its own; every
 * method verifies tenant ownership by joining through the parent
 * FlightSupplier, same pattern as every other module fixed in the
 * cross-tenant sweep.
 */
@Injectable()
export class FlightSupplierContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertSupplierInTenant(
    supplierId: string,
    tenantCompanyId?: string,
  ): Promise<void> {
    const supplier = await this.prisma.flightSupplier.findUnique({
      where: { id: supplierId },
      select: { companyId: true },
    });
    if (
      !supplier ||
      (tenantCompanyId !== undefined && supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Flight supplier not found');
    }
  }

  async listForSupplier(supplierId: string, tenantCompanyId?: string) {
    await this.assertSupplierInTenant(supplierId, tenantCompanyId);
    return this.prisma.flightSupplierContract.findMany({
      where: { supplierId },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(
    supplierId: string,
    dto: CreateFlightSupplierContractDto,
    tenantCompanyId?: string,
  ) {
    await this.assertSupplierInTenant(supplierId, tenantCompanyId);

    return this.prisma.flightSupplierContract.create({
      data: {
        supplierId,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        commissionPercent: dto.commissionPercent,
        markupPercent: dto.markupPercent,
        currency: dto.currency,
        settlementTerms: dto.settlementTerms,
        ticketingTerms: dto.ticketingTerms,
        cancellationRules: dto.cancellationRules,
        contactPerson: dto.contactPerson,
        documentUrl: dto.documentUrl,
      },
    });
  }

  private async get(id: string, tenantCompanyId?: string) {
    const contract = await this.prisma.flightSupplierContract.findUnique({
      where: { id },
      include: { supplier: { select: { companyId: true } } },
    });
    if (
      !contract ||
      (tenantCompanyId !== undefined &&
        contract.supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Supplier contract not found');
    }
    return contract;
  }

  async update(
    id: string,
    dto: UpdateFlightSupplierContractDto,
    tenantCompanyId?: string,
  ) {
    await this.get(id, tenantCompanyId);
    return this.prisma.flightSupplierContract.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  /** Contracts ending within the alert window and not already marked EXPIRED/TERMINATED. */
  async listExpiringSoon(tenantCompanyId?: string) {
    const cutoff = new Date(
      Date.now() + EXPIRY_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.prisma.flightSupplierContract.findMany({
      where: {
        endDate: { lte: cutoff, not: null },
        status: {
          notIn: [
            FlightSupplierContractStatus.EXPIRED,
            FlightSupplierContractStatus.TERMINATED,
          ],
        },
        ...(tenantCompanyId !== undefined && {
          supplier: { companyId: tenantCompanyId },
        }),
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { endDate: 'asc' },
    });
  }
}
