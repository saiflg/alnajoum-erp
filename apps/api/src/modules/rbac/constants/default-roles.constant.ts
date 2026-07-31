import { ALL_PERMISSION_KEYS, PERMISSIONS } from './permissions.constant';

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPANY_ADMIN: 'COMPANY_ADMIN',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;

/**
 * Dashboard each role lands on immediately after login. Checked top-to-bottom
 * — an identity's highest-precedence role wins when it holds several.
 */
export const ROLE_DASHBOARD_PRECEDENCE: Array<{
  role: string;
  dashboardPath: string;
}> = [
  { role: SYSTEM_ROLES.SUPER_ADMIN, dashboardPath: '/admin/dashboard' },
  { role: SYSTEM_ROLES.COMPANY_ADMIN, dashboardPath: '/admin/dashboard' },
  { role: SYSTEM_ROLES.FINANCE_OFFICER, dashboardPath: '/finance/dashboard' },
  { role: SYSTEM_ROLES.BRANCH_MANAGER, dashboardPath: '/branch/dashboard' },
  { role: SYSTEM_ROLES.STAFF, dashboardPath: '/staff/dashboard' },
  { role: SYSTEM_ROLES.CUSTOMER, dashboardPath: '/portal/dashboard' },
];

export const DEFAULT_ROLE_DEFINITIONS: Array<{
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}> = [
  {
    name: SYSTEM_ROLES.SUPER_ADMIN,
    description: 'Full platform access across all companies and branches.',
    isSystem: true,
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    name: SYSTEM_ROLES.COMPANY_ADMIN,
    description: 'Manages a single company: its branches, staff, and roles.',
    isSystem: true,
    permissions: [
      PERMISSIONS.COMPANY.READ,
      PERMISSIONS.COMPANY.UPDATE,
      PERMISSIONS.BRANCH.CREATE,
      PERMISSIONS.BRANCH.READ,
      PERMISSIONS.BRANCH.UPDATE,
      PERMISSIONS.BRANCH.DELETE,
      PERMISSIONS.STAFF.CREATE,
      PERMISSIONS.STAFF.READ,
      PERMISSIONS.STAFF.UPDATE,
      PERMISSIONS.STAFF.DELETE,
      PERMISSIONS.CUSTOMER.READ,
      PERMISSIONS.CUSTOMER.UPDATE,
      PERMISSIONS.CUSTOMER.DELETE,
      PERMISSIONS.ROLE.READ,
      PERMISSIONS.ROLE.ASSIGN,
      PERMISSIONS.AUDIT.READ,
    ],
  },
  {
    name: SYSTEM_ROLES.BRANCH_MANAGER,
    description: 'Manages operations and staff within an assigned branch.',
    isSystem: true,
    permissions: [
      PERMISSIONS.BRANCH.READ,
      PERMISSIONS.BRANCH.UPDATE,
      PERMISSIONS.STAFF.READ,
      PERMISSIONS.STAFF.UPDATE,
      PERMISSIONS.CUSTOMER.READ,
    ],
  },
  {
    name: SYSTEM_ROLES.FINANCE_OFFICER,
    description: 'Read access to company/branch data for finance reporting.',
    isSystem: true,
    permissions: [
      PERMISSIONS.COMPANY.READ,
      PERMISSIONS.BRANCH.READ,
      PERMISSIONS.AUDIT.READ,
    ],
  },
  {
    name: SYSTEM_ROLES.STAFF,
    description: 'Baseline internal staff access.',
    isSystem: true,
    permissions: [PERMISSIONS.STAFF.READ, PERMISSIONS.CUSTOMER.READ],
  },
  {
    name: SYSTEM_ROLES.CUSTOMER,
    description: 'Public website / customer portal end-user.',
    isSystem: true,
    permissions: [],
  },
];
