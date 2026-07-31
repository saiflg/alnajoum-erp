import { IdentityType } from '@prisma/client';

/** Decoded, verified access-token payload attached to `request.user`. */
export interface AuthContext {
  sub: string; // Identity id
  type: IdentityType;
  roles: string[];
  permissions: string[];
}
