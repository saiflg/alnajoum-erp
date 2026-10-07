/**
 * Phase 22 — one definition of "are we production", and which providers must never be
 * a stand-in in production.
 *
 * The mock payment provider reports every payment as successful and the mock WhatsApp
 * provider accepts unsigned webhooks. They exist so the whole system can be exercised on
 * a laptop; in production they would let a customer pay nothing and let anyone forge
 * inbound messages. So production REFUSES them, rather than trusting that someone
 * remembered to configure a real one.
 */

export const isProductionEnv = (
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean => nodeEnv === 'production';

/** Provider kinds whose mock implementation is unsafe in production (a hard refusal). */
export const MOCK_FORBIDDEN_IN_PRODUCTION = ['PAYMENT', 'WHATSAPP'] as const;

/** Provider kinds where a mock is merely non-functional in production (a loud warning). */
export const MOCK_DISCOURAGED_IN_PRODUCTION = [
  'NOTIFICATION',
  'FLIGHT',
  'AI',
] as const;

export interface ProductionConfigIssue {
  level: 'error' | 'warning';
  key: string;
  message: string;
}

const PLACEHOLDER =
  /replace|changeme|change_me|example|secret|password|dev_|test_|xxxx|todo/i;

/**
 * The checks run at startup when NODE_ENV=production. Errors stop the process from booting;
 * warnings are logged. Pure (takes the environment as an argument) so it is fully testable.
 */
export function checkProductionConfig(
  env: Record<string, unknown>,
): ProductionConfigIssue[] {
  if (
    !isProductionEnv(
      typeof env.NODE_ENV === 'string' ? env.NODE_ENV : undefined,
    )
  )
    return [];
  const issues: ProductionConfigIssue[] = [];
  const str = (k: string): string => (typeof env[k] === 'string' ? env[k] : '');
  const err = (key: string, message: string) =>
    issues.push({ level: 'error', key, message });
  const warn = (key: string, message: string) =>
    issues.push({ level: 'warning', key, message });

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const v = str(key);
    if (v.length < 32)
      err(key, `${key} must be at least 32 characters in production`);
    else if (PLACEHOLDER.test(v))
      err(
        key,
        `${key} looks like a placeholder or default; generate a random value (e.g. openssl rand -hex 48)`,
      );
  }
  if (
    str('JWT_ACCESS_SECRET') &&
    str('JWT_ACCESS_SECRET') === str('JWT_REFRESH_SECRET')
  )
    err(
      'JWT_REFRESH_SECRET',
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    );

  const mock = (k: string): boolean =>
    (str(k) || 'mock').toLowerCase() === 'mock';
  if (mock('PAYMENT_PROVIDER'))
    err(
      'PAYMENT_PROVIDER',
      'The mock payment provider is forbidden in production: it reports every payment as successful. Set PAYMENT_PROVIDER=paystack (or another real provider).',
    );
  if (mock('WHATSAPP_PROVIDER'))
    err(
      'WHATSAPP_PROVIDER',
      'The mock WhatsApp provider is forbidden in production: it accepts unsigned webhooks. Set WHATSAPP_PROVIDER=meta.',
    );
  if (mock('NOTIFICATION_PROVIDER'))
    warn(
      'NOTIFICATION_PROVIDER',
      'NOTIFICATION_PROVIDER is mock: no email will actually be sent (password resets will not arrive).',
    );
  if (mock('FLIGHT_PROVIDER'))
    warn(
      'FLIGHT_PROVIDER',
      'FLIGHT_PROVIDER is mock: flight bookings will not reach a real airline system.',
    );

  const origin = str('PUBLIC_WEB_ORIGIN');
  if (!origin)
    err(
      'PUBLIC_WEB_ORIGIN',
      'PUBLIC_WEB_ORIGIN is required in production (it builds password-reset and payment-return links)',
    );
  else if (!origin.startsWith('https://'))
    warn(
      'PUBLIC_WEB_ORIGIN',
      'PUBLIC_WEB_ORIGIN is not https: cookies marked Secure will not work and traffic is unencrypted. Set up a domain and TLS before real use.',
    );
  if (!str('CORS_ORIGIN') && !origin)
    err(
      'CORS_ORIGIN',
      'CORS_ORIGIN (or PUBLIC_WEB_ORIGIN) is required in production',
    );
  if (str('DATABASE_URL').includes('alnajoum_dev_password'))
    err('DATABASE_URL', 'DATABASE_URL uses the development database password');
  return issues;
}
