import {
  DEV_BOOTSTRAP_EMAIL,
  KNOWN_DEFAULT_PASSWORDS,
  resolveBootstrapCredentials,
} from './bootstrap-credentials';

describe('resolveBootstrapCredentials', () => {
  it('uses the development fixture outside production when nothing is configured', () => {
    const c = resolveBootstrapCredentials({ NODE_ENV: 'development' });
    expect(c.email).toBe(DEV_BOOTSTRAP_EMAIL);
    expect(c.source).toBe('development-default');
    expect(KNOWN_DEFAULT_PASSWORDS).toContain(c.password);
  });

  it('prefers configured values anywhere', () => {
    const c = resolveBootstrapCredentials({
      NODE_ENV: 'development',
      BOOTSTRAP_ADMIN_EMAIL: 'Owner@Example.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'x',
    });
    expect(c).toEqual({
      email: 'owner@example.com',
      password: 'x',
      source: 'environment',
    });
  });

  it('refuses to bootstrap production without a password', () => {
    expect(() =>
      resolveBootstrapCredentials({ NODE_ENV: 'production' }),
    ).toThrow(/required in production/);
    expect(() =>
      resolveBootstrapCredentials({
        NODE_ENV: 'production',
        BOOTSTRAP_ADMIN_EMAIL: 'a@b.co',
      }),
    ).toThrow(/required in production/);
  });

  it.each(KNOWN_DEFAULT_PASSWORDS)(
    'refuses the published default %s in production',
    (pw) => {
      expect(() =>
        resolveBootstrapCredentials({
          NODE_ENV: 'production',
          BOOTSTRAP_ADMIN_EMAIL: 'a@b.co',
          BOOTSTRAP_ADMIN_PASSWORD: pw,
        }),
      ).toThrow();
    },
  );

  it('refuses a short password and the built-in email in production', () => {
    expect(() =>
      resolveBootstrapCredentials({
        NODE_ENV: 'production',
        BOOTSTRAP_ADMIN_EMAIL: 'a@b.co',
        BOOTSTRAP_ADMIN_PASSWORD: 'short',
      }),
    ).toThrow(/12 characters/);
    expect(() =>
      resolveBootstrapCredentials({
        NODE_ENV: 'production',
        BOOTSTRAP_ADMIN_PASSWORD: 'a-long-unique-passphrase-7',
      }),
    ).toThrow(/BOOTSTRAP_ADMIN_EMAIL/);
  });

  it('accepts a strong password with a real address in production', () => {
    const c = resolveBootstrapCredentials({
      NODE_ENV: 'production',
      BOOTSTRAP_ADMIN_EMAIL: 'owner@company.example',
      BOOTSTRAP_ADMIN_PASSWORD: 'a-long-unique-passphrase-7',
    });
    expect(c.source).toBe('environment');
  });
});
