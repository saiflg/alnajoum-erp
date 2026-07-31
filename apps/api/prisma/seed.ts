/**
 * Phase 1 bootstrap seed: permission catalogue, system roles, and the first
 * Company/Branch/Super Admin so the platform is usable before any UI exists.
 * Safe to re-run — every step is an upsert / existence check.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  DEFAULT_ROLE_DEFINITIONS,
  SYSTEM_ROLES,
} from '../src/modules/rbac/constants/default-roles.constant';
import { ALL_PERMISSION_KEYS } from '../src/modules/rbac/constants/permissions.constant';

const prisma = new PrismaClient();

const BOOTSTRAP_ADMIN_EMAIL = 'admin@alnajoum.travel';
const BOOTSTRAP_ADMIN_PASSWORD = 'Alnajoum@2026';

async function seedPermissions() {
  for (const key of ALL_PERMISSION_KEYS) {
    const [module] = key.split(':');
    await prisma.permission.upsert({
      where: { key },
      create: { key, module },
      update: {},
    });
  }
  console.log(`Seeded ${ALL_PERMISSION_KEYS.length} permissions`);
}

async function seedRoles() {
  for (const definition of DEFAULT_ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { name: definition.name },
      create: {
        name: definition.name,
        description: definition.description,
        isSystem: definition.isSystem,
      },
      update: {},
    });

    if (definition.permissions.length === 0) continue;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: definition.permissions } },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }
  console.log(`Seeded ${DEFAULT_ROLE_DEFINITIONS.length} system roles`);
}

async function seedBootstrapCompany() {
  const existingAdmin = await prisma.identity.findUnique({
    where: { email: BOOTSTRAP_ADMIN_EMAIL },
  });
  if (existingAdmin) {
    console.log('Bootstrap Super Admin already exists — skipping');
    return;
  }

  const company = await prisma.company.upsert({
    where: { registrationNumber: 'ALNAJOUM-HQ-0001' },
    create: {
      name: 'Alnajoum Travel',
      legalName: 'Alnajoum Travel Limited',
      registrationNumber: 'ALNAJOUM-HQ-0001',
      email: 'info@alnajoum.travel',
    },
    update: {},
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HQ' } },
    create: {
      companyId: company.id,
      name: 'Head Office',
      code: 'HQ',
      city: 'Lagos',
      country: 'Nigeria',
      isHeadOffice: true,
    },
    update: {},
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: SYSTEM_ROLES.SUPER_ADMIN },
  });

  const passwordHash = await argon2.hash(BOOTSTRAP_ADMIN_PASSWORD);

  const identity = await prisma.identity.create({
    data: {
      email: BOOTSTRAP_ADMIN_EMAIL,
      passwordHash,
      type: 'STAFF',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      staff: {
        create: {
          companyId: company.id,
          branchId: branch.id,
          employeeCode: 'SA-0001',
          firstName: 'Super',
          lastName: 'Admin',
          jobTitle: 'Super Administrator',
        },
      },
      roles: { create: [{ roleId: superAdminRole.id }] },
    },
  });

  console.log('--------------------------------------------------------');
  console.log('Bootstrap Super Admin created:');
  console.log(`  email:    ${identity.email}`);
  console.log(`  password: ${BOOTSTRAP_ADMIN_PASSWORD}`);
  console.log('  Change this password immediately after first login.');
  console.log('--------------------------------------------------------');
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedBootstrapCompany();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
