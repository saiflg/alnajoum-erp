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
import {
  KNOWN_DEFAULT_PASSWORDS,
  resolveBootstrapCredentials,
} from '../src/common/security/bootstrap-credentials';
import { ALL_PERMISSION_KEYS } from '../src/modules/rbac/constants/permissions.constant';

const prisma = new PrismaClient();

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

/**
 * Feature flags fail closed: a module guarded by @RequireFeature answers 403 until its flag row exists and is on.
 * Without these rows a fresh install has Visa, Hajj, Umrah, Hotels, Group and Corporate travel switched off. Created
 * only when missing (update: {}), so an administrator's later choice is never overwritten. Automatic payouts stay OFF:
 * moving money without a person pressing the button must be a deliberate decision.
 */
const FEATURE_FLAGS: Array<{ key: string; description: string; on: boolean }> =
  [
    {
      key: 'ENABLE_VISA',
      description: 'Visa services, applications and incentives',
      on: true,
    },
    {
      key: 'ENABLE_HAJJ',
      description: 'Hajj packages and registrations',
      on: true,
    },
    {
      key: 'ENABLE_UMRAH',
      description: 'Umrah packages and registrations',
      on: true,
    },
    { key: 'ENABLE_HOTELS', description: 'Hotel booking', on: true },
    {
      key: 'ENABLE_GROUP_BOOKINGS',
      description: 'Flight group bookings',
      on: true,
    },
    {
      key: 'ENABLE_CORPORATE_TRAVEL',
      description: 'Corporate travel accounts',
      on: true,
    },
    {
      key: 'ENABLE_AUTOMATIC_PAYOUT',
      description:
        'Pay approved staff incentives automatically (off by default)',
      on: false,
    },
  ];

async function seedFeatureFlags() {
  for (const f of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      create: {
        key: f.key,
        description: f.description,
        isEnabledByDefault: f.on,
      },
      update: {},
    });
  }
  console.log(
    `Ensured ${FEATURE_FLAGS.length} feature flags exist (existing values untouched)`,
  );
}

async function seedBootstrapCompany() {
  // Throws (so the seed fails loudly) when production has no real credentials configured.
  const credentials = resolveBootstrapCredentials();
  const existingAdmin = await prisma.identity.findUnique({
    where: { email: credentials.email },
  });
  if (existingAdmin) {
    // An admin that still has a published password is a standing hole in production.
    if (process.env.NODE_ENV === 'production') {
      for (const known of KNOWN_DEFAULT_PASSWORDS) {
        if (await argon2.verify(existingAdmin.passwordHash, known)) {
          throw new Error(
            `The Super Admin ${existingAdmin.email} still has a published default password. Change it before deploying.`,
          );
        }
      }
    }
    console.log('Bootstrap Super Admin already exists — skipping');
    return;
  }

  const company = await prisma.company.upsert({
    where: { registrationNumber: 'RC-6860328' },
    create: {
      name: 'Alnajoum Travel Agency',
      legalName: 'Alnajoum Travel Agency Limited',
      registrationNumber: 'RC-6860328',
      email: 'alnajoumtravelagency@gmail.com',
      phone: '+2348141906416',
      address: 'Kankia Street, Unguwar Sarki, Kaduna, Kaduna State',
    },
    update: {},
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HQ' } },
    create: {
      companyId: company.id,
      name: 'Head Office',
      code: 'HQ',
      city: 'Kaduna',
      country: 'Nigeria',
      isHeadOffice: true,
    },
    update: {},
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: SYSTEM_ROLES.SUPER_ADMIN },
  });

  const passwordHash = await argon2.hash(credentials.password);

  const identity = await prisma.identity.create({
    data: {
      email: credentials.email,
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

  // The password is never printed. In development it is the documented fixture; elsewhere it is the
  // value the operator supplied in BOOTSTRAP_ADMIN_PASSWORD.
  console.log(`Bootstrap Super Admin created: ${identity.email}`);
  console.log(
    credentials.source === 'development-default'
      ? '  Password: the development default (see README). Not for any shared environment.'
      : '  Password: the value of BOOTSTRAP_ADMIN_PASSWORD.',
  );
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedFeatureFlags();
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
