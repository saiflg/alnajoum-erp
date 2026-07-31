import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Restricts a route to identities holding at least one of the given role names. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
