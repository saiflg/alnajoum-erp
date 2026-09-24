import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GovernanceModule } from '../governance/governance.module';
import { UsersModule } from '../users/users.module';
import { MockSupplierInventoryProviderService } from './providers/mock-supplier-inventory-provider.service';
import { SupplierContractsController } from './supplier-contracts.controller';
import { SupplierContractsService } from './supplier-contracts.service';
import { SupplierDocumentsController } from './supplier-documents.controller';
import { SupplierDocumentsService } from './supplier-documents.service';
import { SupplierOnboardingService } from './supplier-onboarding.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/**
 * Phase 16 — the domain-agnostic Supplier management foundation. See
 * Supplier's own schema doc comment for what this reuses (FlightSupplier/
 * SupplierPayable/ApprovalRequest/AuditService/the document-storage util)
 * vs. builds new (the Supplier/SupplierContact/SupplierDocument/
 * SupplierContract models, the onboarding workflow, and the
 * SupplierInventoryProviderPort abstraction + one mock implementation).
 *
 * Deliberately scoped, matching this codebase's established "build a real,
 * tested increment; document the rest as deferred" discipline (see Phase
 * 13/14's own module doc comments for precedent). DEFERRED this pass: rate
 * plan management, hotel date-ranged allotment/inventory calendar, real
 * supplier inventory sync (REST/XML/SFTP/CSV), bulk rate-sheet import,
 * a supplier-facing self-service portal/extranet, dynamic packaging, the
 * multi-supplier routing/failover engine, the B2B/distribution/partner-
 * pricing API (no such system exists anywhere in this codebase yet — not
 * a Phase 16 gap specifically, see the final report), commission/rebate
 * accrual tracking, supplier settlement/wallet, statement exports, the
 * reconciliation engine, ADM/ACM, automated contract-expiry
 * notifications (listExpiringSoon's query exists; nothing sends a
 * notification from it yet), inventory snapshots, disputes, performance
 * scorecards, and the full admin control-center dashboard (a basic list/
 * detail UI is built, not the KPI dashboard).
 */
@Module({
  imports: [AuditModule, GovernanceModule, UsersModule],
  controllers: [
    SuppliersController,
    SupplierContractsController,
    SupplierDocumentsController,
  ],
  providers: [
    SuppliersService,
    SupplierOnboardingService,
    SupplierContractsService,
    SupplierDocumentsService,
    MockSupplierInventoryProviderService,
  ],
  exports: [SuppliersService],
})
export class SuppliersModule {}
