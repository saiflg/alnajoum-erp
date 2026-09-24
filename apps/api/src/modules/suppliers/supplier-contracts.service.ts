import { Injectable, NotFoundException } from '@nestjs/common';
import { SupplierContractStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierContractDto } from './dto/create-supplier-contract.dto';
import { UpdateSupplierContractDto } from './dto/update-supplier-contract.dto';

/** Spec #34 — "alert before contract expiry." A window, not a single day,
 * mirroring FlightSupplierContractsService's own EXPIRY_ALERT_WINDOW_DAYS. */
const EXPIRY_ALERT_WINDOW_DAYS = 30;

/**
 * Mirrors FlightSupplierContractsService exactly — a contract has no
 * companyId of its own, so every method verifies tenant ownership by
 * joining through the parent Supplier.
 */
@Injectable()
export class SupplierContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async assertSupplierInTenant(
    supplierId: string,
    tenantCompanyId?: string,
  ): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { companyId: true },
    });
    if (
      !supplier ||
      (tenantCompanyId !== undefined && supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Supplier not found');
    }
  }

  async listForSupplier(supplierId: string, tenantCompanyId?: string) {
    await this.assertSupplierInTenant(supplierId, tenantCompanyId);
    return this.prisma.supplierContract.findMany({
      where: { supplierId },
      orderBy: { startDate: 'desc' },
    });
  }

  async create(
    supplierId: string,
    dto: CreateSupplierContractDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    await this.assertSupplierInTenant(supplierId, tenantCompanyId);

    const contract = await this.prisma.supplierContract.create({
      data: {
        supplierId,
        contractNumber: dto.contractNumber,
        name: dto.name,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        currency: dto.currency,
        paymentTerms: dto.paymentTerms,
        creditTerms: dto.creditTerms,
        commissionPercent: dto.commissionPercent,
        rebatePercent: dto.rebatePercent,
        markupPercent: dto.markupPercent,
        settlementCycle: dto.settlementCycle,
        cancellationConditions: dto.cancellationConditions,
        amendmentConditions: dto.amendmentConditions,
        documentUrl: dto.documentUrl,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier_contract.created',
      entityType: 'SupplierContract',
      entityId: contract.id,
      metadata: { supplierId, contractNumber: contract.contractNumber },
    });
    return contract;
  }

  private async get(id: string, tenantCompanyId?: string) {
    const contract = await this.prisma.supplierContract.findUnique({
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
    dto: UpdateSupplierContractDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    const updated = await this.prisma.supplierContract.update({
      where: { id },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier_contract.updated',
      entityType: 'SupplierContract',
      entityId: id,
      previousValue: { status: existing.status },
      newValue: { status: updated.status },
    });
    return updated;
  }

  /** Contracts ending within the alert window and not already EXPIRED/TERMINATED. */
  async listExpiringSoon(tenantCompanyId?: string) {
    const cutoff = new Date(
      Date.now() + EXPIRY_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.prisma.supplierContract.findMany({
      where: {
        endDate: { lte: cutoff, not: null },
        status: {
          notIn: [
            SupplierContractStatus.EXPIRED,
            SupplierContractStatus.TERMINATED,
          ],
        },
        ...(tenantCompanyId !== undefined && {
          supplier: { companyId: tenantCompanyId },
        }),
      },
      include: { supplier: { select: { legalName: true } } },
      orderBy: { endDate: 'asc' },
    });
  }
}
