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
  },
  HOTEL: {
    BOOK: 'hotel:book',
    READ: 'hotel:read',
    CANCEL: 'hotel:cancel',
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
} as const;

export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group),
);
