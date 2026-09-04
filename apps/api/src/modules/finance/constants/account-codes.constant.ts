import { AccountType } from '@prisma/client';

/**
 * The seeded chart of accounts (Phase 6 spec #2). Every code here is a
 * stable identifier application code posts against via LedgerService — once
 * seeded, a code must never be reassigned to a different account, the same
 * rule this codebase already applies to RBAC permission keys
 * (permissions.constant.ts) and IntegrationCategory values. An admin can
 * still create additional (non-system) accounts from the Chart of Accounts
 * screen; these constants only cover the ones LedgerService's automatic
 * posting logic needs to find by code.
 */
export const ACCOUNT_CODES = {
  // Assets
  CASH: '1000',
  BANK_ACCOUNTS: '1010',
  CUSTOMER_RECEIVABLES: '1020',
  WALLET_ASSETS: '1030',
  SUPPLIER_DEPOSITS: '1040',

  // Liabilities
  CUSTOMER_WALLET_LIABILITY: '2000',
  CUSTOMER_DEPOSITS: '2010',
  STAFF_INCENTIVE_PAYABLE: '2020',
  SUPPLIER_PAYABLES: '2030',

  // Revenue
  FLIGHT_REVENUE: '4000',
  VISA_REVENUE: '4010',
  HOTEL_REVENUE: '4020',
  HAJJ_REVENUE: '4030',
  UMRAH_REVENUE: '4040',
  SERVICE_FEES: '4050',
  OTHER_REVENUE: '4060',

  // Expenses
  STAFF_EXPENSES: '5000',
  OFFICE_EXPENSES: '5010',
  MARKETING: '5020',
  HOSTING: '5030',
  API_COSTS: '5040',
  BANK_CHARGES: '5050',
  REFUND_LOSSES: '5060',
  OTHER_EXPENSES: '5070',
  // Not in the spec's literal Expenses list, but required to recognize
  // supplier cost against Supplier Payables (spec #9's "Company Cost" /
  // #20's supplier payables) without inventing a second parallel ledger —
  // every "Cost of Services" journal line has sourceModule set to the
  // originating booking type, so P&L can still break cost down by service
  // (spec #17) without needing one ledger account per service.
  COST_OF_SERVICES: '5080',

  // Equity
  COMPANY_INVESTMENT: '3000',
  OWNER_EQUITY: '3010',
  RETAINED_EARNINGS: '3020',
} as const;

export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];

interface SeedAccountDef {
  code: string;
  name: string;
  type: AccountType;
}

export const SEED_ACCOUNTS: SeedAccountDef[] = [
  { code: ACCOUNT_CODES.CASH, name: 'Cash', type: AccountType.ASSET },
  {
    code: ACCOUNT_CODES.BANK_ACCOUNTS,
    name: 'Bank Accounts',
    type: AccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.CUSTOMER_RECEIVABLES,
    name: 'Customer Receivables',
    type: AccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.WALLET_ASSETS,
    name: 'Wallet Assets',
    type: AccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.SUPPLIER_DEPOSITS,
    name: 'Supplier Deposits',
    type: AccountType.ASSET,
  },

  {
    code: ACCOUNT_CODES.CUSTOMER_WALLET_LIABILITY,
    name: 'Customer Wallet Liability',
    type: AccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.CUSTOMER_DEPOSITS,
    name: 'Customer Deposits',
    type: AccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.STAFF_INCENTIVE_PAYABLE,
    name: 'Staff Incentive Payable',
    type: AccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.SUPPLIER_PAYABLES,
    name: 'Supplier Payables',
    type: AccountType.LIABILITY,
  },

  {
    code: ACCOUNT_CODES.FLIGHT_REVENUE,
    name: 'Flight Revenue',
    type: AccountType.REVENUE,
  },
  {
    code: ACCOUNT_CODES.VISA_REVENUE,
    name: 'Visa Revenue',
    type: AccountType.REVENUE,
  },
  {
    code: ACCOUNT_CODES.HOTEL_REVENUE,
    name: 'Hotel Revenue',
    type: AccountType.REVENUE,
  },
  {
    code: ACCOUNT_CODES.HAJJ_REVENUE,
    name: 'Hajj Revenue',
    type: AccountType.REVENUE,
  },
  {
    code: ACCOUNT_CODES.UMRAH_REVENUE,
    name: 'Umrah Revenue',
    type: AccountType.REVENUE,
  },
  {
    code: ACCOUNT_CODES.SERVICE_FEES,
    name: 'Service Fees',
    type: AccountType.REVENUE,
  },
  {
    code: ACCOUNT_CODES.OTHER_REVENUE,
    name: 'Other Revenue',
    type: AccountType.REVENUE,
  },

  {
    code: ACCOUNT_CODES.STAFF_EXPENSES,
    name: 'Staff Expenses',
    type: AccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.OFFICE_EXPENSES,
    name: 'Office Expenses',
    type: AccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.MARKETING,
    name: 'Marketing',
    type: AccountType.EXPENSE,
  },
  { code: ACCOUNT_CODES.HOSTING, name: 'Hosting', type: AccountType.EXPENSE },
  {
    code: ACCOUNT_CODES.API_COSTS,
    name: 'API Costs',
    type: AccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.BANK_CHARGES,
    name: 'Bank Charges',
    type: AccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.REFUND_LOSSES,
    name: 'Refund Losses',
    type: AccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.OTHER_EXPENSES,
    name: 'Other Expenses',
    type: AccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.COST_OF_SERVICES,
    name: 'Cost of Services',
    type: AccountType.EXPENSE,
  },

  {
    code: ACCOUNT_CODES.COMPANY_INVESTMENT,
    name: 'Company Investment',
    type: AccountType.EQUITY,
  },
  {
    code: ACCOUNT_CODES.OWNER_EQUITY,
    name: 'Owner Equity',
    type: AccountType.EQUITY,
  },
  {
    code: ACCOUNT_CODES.RETAINED_EARNINGS,
    name: 'Retained Earnings',
    type: AccountType.EQUITY,
  },
];

/** Debit-normal account types (Assets, Expenses) vs credit-normal (Liabilities, Revenue, Equity) — used by LedgerService.getAccountBalance() to sign a balance the way a real trial balance would. */
export function isDebitNormal(type: AccountType): boolean {
  return type === AccountType.ASSET || type === AccountType.EXPENSE;
}
