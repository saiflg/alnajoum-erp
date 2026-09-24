import { Injectable, NotFoundException } from '@nestjs/common';
import { SupplierType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierContactDto } from './dto/create-supplier-contact.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ReviewSupplierDto } from './dto/review-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

/** Same alert threshold FlightSuppliersService uses (spec #23's own worked example). */
const CREDIT_UTILIZATION_ALERT_THRESHOLD = 0.85;

export interface SupplierBalance {
  totalPayable: number;
  totalPaid: number;
  currentBalance: number;
  creditLimit: number | null;
  availableCredit: number | null;
  utilization: number | null;
  alert: string | null;
}

/**
 * Phase 16 — the domain-agnostic Supplier master record (Hotel/Visa/Hajj/
 * Umrah/Transport suppliers). Deliberately mirrors FlightSuppliersService's
 * shape exactly (tenant-scoped CRUD, balance computed live from
 * SupplierPayable rather than stored) — see this model's own schema
 * comment for why flights keep using FlightSupplier/FlightSuppliersService
 * unchanged rather than being migrated onto this.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(
    filters: { type?: SupplierType; onboardingStatus?: string } = {},
    tenantCompanyId?: string,
  ) {
    return this.prisma.supplier.findMany({
      where: {
        ...(filters.type && { type: filters.type }),
        ...(filters.onboardingStatus && {
          onboardingStatus: filters.onboardingStatus as never,
        }),
        ...(tenantCompanyId !== undefined && { companyId: tenantCompanyId }),
      },
      include: {
        accountManagerStaff: { select: { firstName: true, lastName: true } },
      },
      orderBy: { legalName: 'asc' },
    });
  }

  async create(
    dto: CreateSupplierDto,
    companyId: string,
    actorIdentityId: string,
  ) {
    const supplier = await this.prisma.supplier.create({
      data: { ...dto, companyId },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier.created',
      entityType: 'Supplier',
      entityId: supplier.id,
      companyId,
      metadata: { legalName: supplier.legalName, type: supplier.type },
    });
    return supplier;
  }

  async get(id: string, tenantCompanyId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        contacts: true,
        documents: { orderBy: { createdAt: 'desc' } },
        contracts: { orderBy: { createdAt: 'desc' } },
        accountManagerStaff: { select: { firstName: true, lastName: true } },
      },
    });
    if (
      !supplier ||
      (tenantCompanyId !== undefined && supplier.companyId !== tenantCompanyId)
    ) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  async update(
    id: string,
    dto: UpdateSupplierDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: dto,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier.updated',
      entityType: 'Supplier',
      entityId: id,
      companyId: existing.companyId,
      previousValue: existing,
      newValue: updated,
    });
    return updated;
  }

  /** KYC/risk review — a lighter operational action than the onboarding
   * lifecycle transition (see SupplierOnboardingService), since flagging a
   * document as verified or a supplier as higher-risk doesn't by itself
   * change whether the supplier can be booked against. */
  async review(
    id: string,
    dto: ReviewSupplierDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const existing = await this.get(id, tenantCompanyId);
    const updated = await this.prisma.supplier.update({
      where: { id },
      data: dto,
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier.reviewed',
      entityType: 'Supplier',
      entityId: id,
      companyId: existing.companyId,
      metadata: dto as never,
    });
    return updated;
  }

  async addContact(
    supplierId: string,
    dto: CreateSupplierContactDto,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const supplier = await this.get(supplierId, tenantCompanyId);
    const contact = await this.prisma.supplierContact.create({
      data: { ...dto, supplierId },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier.contact_added',
      entityType: 'SupplierContact',
      entityId: contact.id,
      companyId: supplier.companyId,
      metadata: { supplierId },
    });
    return contact;
  }

  async removeContact(
    supplierId: string,
    contactId: string,
    tenantCompanyId: string | undefined,
    actorIdentityId: string,
  ) {
    const supplier = await this.get(supplierId, tenantCompanyId);
    const contact = await this.prisma.supplierContact.findUnique({
      where: { id: contactId },
    });
    if (!contact || contact.supplierId !== supplierId) {
      throw new NotFoundException('Contact not found');
    }
    await this.prisma.supplierContact.delete({ where: { id: contactId } });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'supplier.contact_removed',
      entityType: 'SupplierContact',
      entityId: contactId,
      companyId: supplier.companyId,
      metadata: { supplierId },
    });
  }

  /**
   * Spec #30 — credit limit, current exposure, available credit,
   * utilization, alert. Balance is never a stored column, same "always
   * computed live" discipline as FlightSuppliersService.getBalance()/
   * Wallet — it sums this supplier's linked SupplierPayable/SupplierPayment
   * rows rather than tracking a second, driftable balance.
   */
  async getBalance(
    id: string,
    tenantCompanyId?: string,
  ): Promise<SupplierBalance> {
    const supplier = await this.get(id, tenantCompanyId);
    const payables = await this.prisma.supplierPayable.findMany({
      where: { supplierId: id },
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
