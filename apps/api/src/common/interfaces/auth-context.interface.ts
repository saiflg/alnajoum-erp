import { IdentityType } from '@prisma/client';

/** Decoded, verified access-token payload attached to `request.user`. */
export interface AuthContext {
  sub: string; // Identity id
  type: IdentityType;
  roles: string[];
  permissions: string[];
  // Phase 11 — this identity's tenant, resolved fresh from the DB by
  // JwtAccessStrategy on every request (same reason permissions are:
  // never trust anything long-lived enough to go stale or be forged).
  // null for an identity with no company at all (e.g. Super Admin acting
  // platform-wide, or a customer somehow predating tenant scoping).
  companyId: string | null;
  // Phase 11 spec #16 — the RefreshToken row this access token was minted
  // alongside, so JwtAccessStrategy can bump that session's
  // lastActivityAt and so a "revoke all OTHER sessions" call can tell
  // which one to spare. null only for a token minted before this field
  // existed (falls out of existence in 15 minutes, at the access token's
  // normal expiry).
  sessionId: string | null;
}
