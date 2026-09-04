/**
 * Phase 1 permission catalogue. Every permission key follows `<module>:<action>`.
 * Later phases append to this list — existing keys must never be renamed once
 * assigned to roles, since audit logs and stored role grants reference them.
 */
export const PERMISSIONS = {
  COMPANY: {
    CREATE: 'company:create',
    READ: 'company:read',
    UPDATE: 'company:update',
    DELETE: 'company:delete',
  },
  BRANCH: {
    CREATE: 'branch:create',
    READ: 'branch:read',
    UPDATE: 'branch:update',
    DELETE: 'branch:delete',
  },
  STAFF: {
    CREATE: 'staff:create',
    READ: 'staff:read',
    UPDATE: 'staff:update',
    DELETE: 'staff:delete',
  },
  CUSTOMER: {
    READ: 'customer:read',
    UPDATE: 'customer:update',
    DELETE: 'customer:delete',
  },
  FLIGHT: {
    BOOK: 'flight:book',
    READ: 'flight:read',
    CANCEL: 'flight:cancel',
    // Phase 4 — enterprise flight search/booking/ticketing engine.
    TICKET_ISSUE: 'flight:ticket_issue',
    REISSUE: 'flight:reissue',
    REFUND: 'flight:refund',
    PRICING_MANAGE: 'flight:pricing_manage', // configure markup rules
    GROUP_MANAGE: 'flight:group_manage', // group bookings
    REPORTS_VIEW: 'flight:reports_view', // admin flight dashboard
  },
  HOTEL: {
    BOOK: 'hotel:book',
    READ: 'hotel:read',
    CANCEL: 'hotel:cancel',
    // Phase 5 — enterprise hotel/accommodation/package management.
    MANAGE_CATALOG: 'hotel:manage_catalog', // create/edit hotels and room types
    COMPLETE: 'hotel:complete', // confirm/complete a booking (fires the staff incentive)
    REFUND: 'hotel:refund',
    REPORTS_VIEW: 'hotel:reports_view',
    PACKAGE_MANAGE: 'hotel:package_manage', // build/manage travel packages
  },
  VEHICLE_RENTAL: {
    BOOK: 'vehicle_rental:book',
    READ: 'vehicle_rental:read',
    CANCEL: 'vehicle_rental:cancel',
  },
  VISA_APPLICATION: {
    CREATE: 'visa_application:create',
    READ: 'visa_application:read',
    MANAGE: 'visa_application:manage', // update status, cancel on a customer's behalf
  },
  CORPORATE_TRAVEL: {
    MANAGE: 'corporate_travel:manage', // accounts, travelers, and bookings — staff-only feature
    READ: 'corporate_travel:read',
  },
  INVOICE: {
    READ: 'invoice:read',
  },
  PAYMENT: {
    RECORD: 'payment:record',
  },
  NOTIFICATION: {
    READ: 'notification:read',
  },
  ROLE: {
    CREATE: 'role:create',
    READ: 'role:read',
    UPDATE: 'role:update',
    DELETE: 'role:delete',
    ASSIGN: 'role:assign',
  },
  PERMISSION: {
    READ: 'permission:read',
  },
  AUDIT: {
    READ: 'audit:read',
  },
  WALLET: {
    READ: 'wallet:read',
    READ_ALL: 'wallet:read_all',
    CREDIT: 'wallet:credit',
    ADJUST: 'wallet:adjust',
    TRANSFER: 'wallet:transfer',
  },
  HAJJ_PACKAGE: {
    CREATE: 'hajj_package:create',
    READ: 'hajj_package:read',
    UPDATE: 'hajj_package:update',
    DELETE: 'hajj_package:delete',
  },
  HAJJ_REGISTRATION: {
    CREATE: 'hajj_registration:create',
    READ: 'hajj_registration:read',
    UPDATE: 'hajj_registration:update',
  },
  UMRAH_PACKAGE: {
    CREATE: 'umrah_package:create',
    READ: 'umrah_package:read',
    UPDATE: 'umrah_package:update',
    DELETE: 'umrah_package:delete',
  },
  UMRAH_REGISTRATION: {
    CREATE: 'umrah_registration:create',
    READ: 'umrah_registration:read',
    UPDATE: 'umrah_registration:update',
  },
  MANUAL_PAYMENT: {
    SUBMIT: 'manual_payment:submit',
    REVIEW: 'manual_payment:review',
  },
  STAFF_ASSIGNMENT: {
    READ: 'staff_assignment:read',
    MANAGE: 'staff_assignment:manage',
  },
  REMINDER: {
    RUN: 'reminder:run',
  },
  INTEGRATIONS: {
    READ: 'integrations:read',
    MANAGE: 'integrations:manage',
  },
  // Phase 3 — enterprise visa management. Names follow the spec's own
  // `visa.<action>` scheme (dot-separated) rather than this file's usual
  // `<module>:<action>` convention — the two are otherwise equivalent
  // (Permission.key is just an opaque unique string to the RBAC engine),
  // kept dotted here specifically so they match the spec's literal
  // permission list.
  VISA: {
    VIEW: 'visa.view', // read applications, the VisaService catalog, and their documents
    CREATE: 'visa.create', // submit an application on a customer's behalf; create VisaService catalog entries
    EDIT: 'visa.edit', // edit a VisaService catalog entry or an in-progress application
    ASSIGN: 'visa.assign', // assign an application to a visa officer
    REVIEW: 'visa.review', // move an application through the working statuses (under review, processing, ...)
    APPROVE: 'visa.approve', // approve an application
    REJECT: 'visa.reject', // reject an application
    DOCUMENT_REVIEW: 'visa.document.review', // verify/reject an uploaded document
    GUARANTOR_VERIFY: 'visa.guarantor.verify', // verify/approve/reject a guarantor
    PAYMENT_VERIFY: 'visa.payment.verify', // mark an application's payment as verified
    INCENTIVE_VIEW: 'visa.incentive.view', // view incentive records (company cost, margin, amounts)
    INCENTIVE_APPROVE: 'visa.incentive.approve', // approve/reject a pending incentive
    PAYOUT_APPROVE: 'visa.payout.approve', // trigger/retry an incentive payout
  },
  // Phase 6 — enterprise finance, accounting, payment reconciliation, and
  // staff payout engine.
  FINANCE: {
    ACCOUNTS_MANAGE: 'finance:accounts_manage', // chart of accounts CRUD
    LEDGER_VIEW: 'finance:ledger_view', // journal entries, trial balance
    EXPENSE_CREATE: 'finance:expense_create',
    EXPENSE_APPROVE: 'finance:expense_approve',
    INVESTMENT_MANAGE: 'finance:investment_manage',
    SUPPLIER_PAYABLES_MANAGE: 'finance:supplier_payables_manage',
    DASHBOARD_VIEW: 'finance:dashboard_view', // P&L, cash flow, finance dashboard, branch accounting
    DAILY_CLOSING: 'finance:daily_closing',
    BANK_RECONCILIATION: 'finance:bank_reconciliation',
    STAFF_BANK_VERIFY: 'finance:staff_bank_verify', // verify a staff member's payout bank account
    SETTINGS_MANAGE: 'finance:settings_manage', // payout approval thresholds
    // Spec #14's tiered payout-approval workflow — checked in addition to
    // (never instead of) visa.incentive.approve, against the acting
    // identity's permission set at the amount thresholds configured in
    // FinanceSettings.
    APPROVE_HIGH_VALUE: 'finance:approve_high_value',
    APPROVE_EXECUTIVE: 'finance:approve_executive',
  },
} as const;

export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group),
);
