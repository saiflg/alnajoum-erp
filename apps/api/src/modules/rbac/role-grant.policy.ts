import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SYSTEM_ROLES } from './constants/default-roles.constant';

export interface GrantingUser {
  sub: string;
  roles: string[];
}

/**
 * Who may hand out which role (Phase 22 S-06/S-07).
 *
 * - SUPER_ADMIN may grant anything.
 * - Nobody else may grant SUPER_ADMIN.
 * - Everyone else may only grant a role whose permissions they already hold themselves (a privilege
 *   ceiling), so a tenant admin can never mint more power than they have — including through a custom
 *   role someone created with extra permissions.
 */
export async function assertRoleGrantable(
  prisma: PrismaService,
  actor: GrantingUser,
  role: { id: string; name: string },
): Promise<void> {
  if (actor.roles.includes(SYSTEM_ROLES.SUPER_ADMIN)) return;
  if (role.name === SYSTEM_ROLES.SUPER_ADMIN) {
    throw new ForbiddenException(
      'Only an existing Super Admin can grant the Super Admin role.',
    );
  }
  const [wanted, held] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permission: { select: { key: true } } },
    }),
    prisma.permission.findMany({
      where: {
        roles: {
          some: { role: { identities: { some: { identityId: actor.sub } } } },
        },
      },
      select: { key: true },
    }),
  ]);
  const have = new Set(held.map((p) => p.key));
  const missing = wanted
    .map((w) => w.permission.key)
    .filter((key) => !have.has(key));
  if (missing.length > 0) {
    throw new ForbiddenException(
      `You cannot grant the ${role.name} role: it includes permissions you do not hold yourself (${missing
        .slice(0, 3)
        .join(', ')}${missing.length > 3 ? ', …' : ''}).`,
    );
  }
}
