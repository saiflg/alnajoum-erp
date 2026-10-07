/**
 * Credentials for the first Super Admin created by `prisma db seed` (Phase 22 S-05).
 *
 * The seed used to create admin@alnajoum.travel with a password written in the source code and print
 * it to the deploy log, on every environment. Now:
 *  - production REQUIRES BOOTSTRAP_ADMIN_PASSWORD (12+ characters, not a known default) and the seed
 *    refuses to run without it;
 *  - non-production falls back to the documented development fixture so local setup and the e2e
 *    suite keep working with no configuration;
 *  - the password is never printed.
 */

/** Passwords that appear in this repository and so are public knowledge. */
export const KNOWN_DEFAULT_PASSWORDS: readonly string[] = [
  'Alnajoum@2026',
  'Demo@2026',
];

export const DEV_BOOTSTRAP_EMAIL = 'admin@alnajoum.travel';
const DEV_BOOTSTRAP_PASSWORD = 'Alnajoum@2026';

export interface BootstrapCredentials {
  email: string;
  password: string;
  source: 'environment' | 'development-default';
}

export function resolveBootstrapCredentials(
  env: Record<string, string | undefined> = process.env,
): BootstrapCredentials {
  const production = env.NODE_ENV === 'production';
  const email = (
    env.BOOTSTRAP_ADMIN_EMAIL?.trim() || DEV_BOOTSTRAP_EMAIL
  ).toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!password) {
    if (production) {
      throw new Error(
        'BOOTSTRAP_ADMIN_PASSWORD is required in production: the first Super Admin cannot be created with a built-in password.',
      );
    }
    return {
      email,
      password: DEV_BOOTSTRAP_PASSWORD,
      source: 'development-default',
    };
  }

  if (production) {
    if (password.length < 12) {
      throw new Error(
        'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters in production.',
      );
    }
    if (KNOWN_DEFAULT_PASSWORDS.includes(password)) {
      throw new Error(
        'BOOTSTRAP_ADMIN_PASSWORD is a published default password; choose another.',
      );
    }
    if (
      email === DEV_BOOTSTRAP_EMAIL &&
      env.BOOTSTRAP_ADMIN_EMAIL === undefined
    ) {
      throw new Error(
        'Set BOOTSTRAP_ADMIN_EMAIL to the real administrator address in production.',
      );
    }
  }
  return { email, password, source: 'environment' };
}
