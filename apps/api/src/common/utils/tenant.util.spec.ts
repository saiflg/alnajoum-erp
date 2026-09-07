import { IdentityType } from '@prisma/client';
import { AuthContext } from '../interfaces/auth-context.interface';
import { resolveTenantFilter } from './tenant.util';

function user(overrides: Partial<AuthContext>): AuthContext {
  return {
    sub: 'identity-1',
    type: IdentityType.STAFF,
    roles: ['STAFF'],
    permissions: [],
    companyId: 'company-a',
    sessionId: 'session-1',
    ...overrides,
  };
}

describe('resolveTenantFilter', () => {
  it('returns undefined (no filter) for SUPER_ADMIN', () => {
    expect(
      resolveTenantFilter(user({ roles: ['SUPER_ADMIN'], companyId: null })),
    ).toBeUndefined();
  });

  it("returns the caller's companyId for every other role", () => {
    expect(resolveTenantFilter(user({ companyId: 'company-a' }))).toBe(
      'company-a',
    );
  });

  it('returns a sentinel (never undefined) for a non-SUPER_ADMIN caller with no resolvable tenant', () => {
    const result = resolveTenantFilter(user({ companyId: null }));
    expect(result).not.toBeUndefined();
    expect(result).not.toBe('');
  });
});
