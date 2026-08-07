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
} as const;

export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group),
);
