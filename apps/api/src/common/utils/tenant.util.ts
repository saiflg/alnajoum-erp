import { AuthContext } from '../interfaces/auth-context.interface';

/**
 * Phase 11 spec #2/#3/#65 — the one place that decides whether a caller's
 * tenant filter applies at all. SUPER_ADMIN is explicitly cross-tenant by
 * design (its own role description: "Full platform access across all
 * companies and branches") and is the only role that bypasses this —
 * every other role, no matter how senior otherwise, is confined to its
 * own `companyId`. Returns `undefined` to mean "no filter" (SUPER_ADMIN),
 * never an empty string/null that could accidentally match an
 * unscoped/legacy row — a caller with no companyId who is NOT SUPER_ADMIN
 * gets back a sentinel that can never match a real row, so they see
 * nothing rather than everything if their tenant somehow can't be
 * resolved.
 */
export function resolveTenantFilter(user: AuthContext): string | undefined {
  if (user.roles.includes('SUPER_ADMIN')) {
    return undefined;
  }
  return user.companyId ?? '__no_tenant__';
}
