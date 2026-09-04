import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankReconciliationService } from './bank-reconciliation.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { CompanyInvestmentsController } from './company-investments.controller';
import { CompanyInvestmentsService } from './company-investments.service';
import { DailyClosingController } from './daily-closing.controller';
import { DailyClosingService } from './daily-closing.service';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { FinancePostingService } from './finance-posting.service';
import { FinanceReportsController } from './finance-reports.controller';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceSettingsController } from './finance-settings.controller';
import { FinanceSettingsService } from './finance-settings.service';
import { LedgerService } from './ledger.service';
import { StaffBankAccountsController } from './staff-bank-accounts.controller';
import { StaffBankAccountsService } from './staff-bank-accounts.service';
import { SupplierPayablesController } from './supplier-payables.controller';
import { SupplierPayablesService } from './supplier-payables.service';

/**
 * The finance engine (Phase 6). A leaf module — depends only on
 * Audit/Users, never on Payments/Wallet/Visa/Flights/Hotels — so every one
 * of those can import FinanceModule to post into the ledger without a
 * circular dependency.
 */
@Module({
  imports: [AuditModule, UsersModule],
  controllers: [
    ChartOfAccountsController,
    ExpensesController,
    CompanyInvestmentsController,
    SupplierPayablesController,
    DailyClosingController,
    BankReconciliationController,
    FinanceReportsController,
    StaffBankAccountsController,
    FinanceSettingsController,
  ],
  providers: [
    LedgerService,
    FinancePostingService,
    FinanceSettingsService,
    ExpensesService,
    CompanyInvestmentsService,
    SupplierPayablesService,
    DailyClosingService,
    BankReconciliationService,
    FinanceReportsService,
    StaffBankAccountsService,
  ],
  exports: [
    LedgerService,
    FinancePostingService,
    FinanceSettingsService,
    ExpensesService,
    CompanyInvestmentsService,
    SupplierPayablesService,
  ],
})
export class FinanceModule implements OnModuleInit {
  constructor(private readonly ledgerService: LedgerService) {}

  /** Idempotent chart-of-accounts seed — runs on every app boot, safe to no-op after the first. */
  async onModuleInit() {
    await this.ledgerService.ensureSystemAccounts();
  }
}
