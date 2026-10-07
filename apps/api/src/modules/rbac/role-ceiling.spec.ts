import {
  DEFAULT_ROLE_DEFINITIONS,
  SYSTEM_ROLES,
} from './constants/default-roles.constant';

/**
 * The privilege ceiling (assertRoleGrantable) only lets someone grant a role whose permissions they
 * already hold. For tenant administration to keep working, a COMPANY_ADMIN must therefore hold every
 * permission of the roles they are expected to hand out to their staff.
 */
describe('COMPANY_ADMIN can grant the standard staff roles under the privilege ceiling', () => {
  const byName = new Map(
    DEFAULT_ROLE_DEFINITIONS.map((r) => [r.name, new Set(r.permissions)]),
  );
  const admin = byName.get(SYSTEM_ROLES.COMPANY_ADMIN)!;

  it.each([
    SYSTEM_ROLES.BRANCH_MANAGER,
    SYSTEM_ROLES.FINANCE_OFFICER,
    SYSTEM_ROLES.STAFF,
    SYSTEM_ROLES.AUDITOR,
    SYSTEM_ROLES.REPORT_VIEWER,
  ])('%s', (role) => {
    const missing = [...byName.get(role)!].filter((k) => !admin.has(k));
    expect(missing).toEqual([]);
  });

  it('SUPER_ADMIN is the only role that is not a subset of COMPANY_ADMIN among platform roles', () => {
    const missing = [...byName.get(SYSTEM_ROLES.SUPER_ADMIN)!].filter(
      (k) => !admin.has(k),
    );
    expect(missing.length).toBeGreaterThan(0);
  });
});
