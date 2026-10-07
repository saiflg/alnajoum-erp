import { checkProductionConfig, isProductionEnv } from './runtime-environment';

const good = {
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'a3f9c1d27b5e48f0a1b2c3d4e5f60718293a4b5c6d7e8f90',
  JWT_REFRESH_SECRET: '0f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778',
  DATA_ENCRYPTION_KEYS: '2026a:7nQd0yVJ3m1c2G5kPzXw8bT4uLrHsAe6oFiYtC9vKxM=',
  PAYMENT_PROVIDER: 'paystack',
  WHATSAPP_PROVIDER: 'meta',
  NOTIFICATION_PROVIDER: 'smtp',
  FLIGHT_PROVIDER: 'amadeus',
  PUBLIC_WEB_ORIGIN: 'https://erp.example.org',
  DATABASE_URL: 'postgresql://app:Xk29s@db:5432/erp',
};
const errorsOf = (env: Record<string, unknown>) =>
  checkProductionConfig(env)
    .filter((i) => i.level === 'error')
    .map((i) => i.key);

describe('checkProductionConfig', () => {
  it('reports nothing outside production', () => {
    expect(
      checkProductionConfig({
        NODE_ENV: 'development',
        PAYMENT_PROVIDER: 'mock',
      }),
    ).toEqual([]);
    expect(isProductionEnv('development')).toBe(false);
    expect(isProductionEnv('production')).toBe(true);
  });

  it('accepts a sound production configuration without errors', () => {
    expect(errorsOf(good)).toEqual([]);
  });

  it('rejects the mock payment and WhatsApp providers, including the implicit default', () => {
    expect(errorsOf({ ...good, PAYMENT_PROVIDER: 'mock' })).toContain(
      'PAYMENT_PROVIDER',
    );
    expect(errorsOf({ ...good, PAYMENT_PROVIDER: undefined })).toContain(
      'PAYMENT_PROVIDER',
    );
    expect(errorsOf({ ...good, WHATSAPP_PROVIDER: 'mock' })).toContain(
      'WHATSAPP_PROVIDER',
    );
  });

  it('only warns for mock notification and flight providers', () => {
    const issues = checkProductionConfig({
      ...good,
      NOTIFICATION_PROVIDER: 'mock',
      FLIGHT_PROVIDER: 'mock',
    });
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(issues.map((i) => i.key)).toEqual(
      expect.arrayContaining(['NOTIFICATION_PROVIDER', 'FLIGHT_PROVIDER']),
    );
  });

  it('rejects short, placeholder and identical JWT secrets', () => {
    expect(errorsOf({ ...good, JWT_ACCESS_SECRET: 'short' })).toContain(
      'JWT_ACCESS_SECRET',
    );
    expect(
      errorsOf({
        ...good,
        JWT_ACCESS_SECRET: 'replace-with-a-long-random-string-please',
      }),
    ).toContain('JWT_ACCESS_SECRET');
    expect(
      errorsOf({ ...good, JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET }),
    ).toContain('JWT_REFRESH_SECRET');
  });

  it('requires a well-formed data encryption key', () => {
    expect(errorsOf({ ...good, DATA_ENCRYPTION_KEYS: undefined })).toContain(
      'DATA_ENCRYPTION_KEYS',
    );
    expect(errorsOf({ ...good, DATA_ENCRYPTION_KEYS: 'short' })).toContain(
      'DATA_ENCRYPTION_KEYS',
    );
  });

  it('requires an origin, warns when it is not https, rejects the dev DB password', () => {
    expect(errorsOf({ ...good, PUBLIC_WEB_ORIGIN: '' })).toContain(
      'PUBLIC_WEB_ORIGIN',
    );
    const http = checkProductionConfig({
      ...good,
      PUBLIC_WEB_ORIGIN: 'http://1.2.3.4',
    });
    expect(http.find((i) => i.key === 'PUBLIC_WEB_ORIGIN')?.level).toBe(
      'warning',
    );
    expect(
      errorsOf({
        ...good,
        DATABASE_URL: 'postgresql://x:alnajoum_dev_password@db/erp',
      }),
    ).toContain('DATABASE_URL');
  });
});
