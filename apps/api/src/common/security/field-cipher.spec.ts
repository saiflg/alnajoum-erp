import { randomBytes } from 'crypto';
import { FieldCipher } from './field-cipher';

const key = () => randomBytes(32).toString('base64');
const env = (extra: Record<string, string>) =>
  ({ NODE_ENV: 'test', ...extra }) as NodeJS.ProcessEnv;

describe('FieldCipher', () => {
  const cipher = FieldCipher.fromEnv(
    env({ DATA_ENCRYPTION_KEYS: `k1:${key()}` }),
  );

  it('round-trips and never contains the plaintext', () => {
    const out = cipher.encrypt('sk_live_super_secret', 'ctx');
    expect(out.startsWith('enc:v1:k1:')).toBe(true);
    expect(out).not.toContain('sk_live_super_secret');
    expect(cipher.decrypt(out, 'ctx')).toBe('sk_live_super_secret');
  });

  it('uses a fresh IV each time', () => {
    expect(cipher.encrypt('x', 'ctx')).not.toBe(cipher.encrypt('x', 'ctx'));
  });

  it('refuses to decrypt under a different context (value moved to another row/field)', () => {
    const out = cipher.encrypt(
      'secret',
      'integration:PAYMENT:paystack:secretKey',
    );
    expect(() =>
      cipher.decrypt(out, 'integration:PAYMENT:opay:secretKey'),
    ).toThrow();
  });

  it('detects tampering', () => {
    const out = cipher.encrypt('secret', 'ctx');
    const parts = out.split(':');
    parts[5] = Buffer.from('tampered').toString('base64url');
    expect(() => cipher.decrypt(parts.join(':'), 'ctx')).toThrow();
  });

  it('passes legacy plaintext through and flags it for rotation', () => {
    expect(FieldCipher.isEncrypted('plain')).toBe(false);
    expect(cipher.decryptIfEncrypted('plain', 'ctx')).toBe('plain');
    expect(cipher.needsRotation('plain')).toBe(true);
    expect(cipher.needsRotation(cipher.encrypt('v', 'ctx'))).toBe(false);
  });

  it('rotates to a new key while old values still decrypt', () => {
    const k1 = key();
    const k2 = key();
    const old = FieldCipher.fromEnv(env({ DATA_ENCRYPTION_KEYS: `k1:${k1}` }));
    const stored = old.encrypt('secret', 'ctx');

    const rotated = FieldCipher.fromEnv(
      env({
        DATA_ENCRYPTION_KEYS: `k1:${k1},k2:${k2}`,
        DATA_ENCRYPTION_KEY_ID: 'k2',
      }),
    );
    expect(rotated.decrypt(stored, 'ctx')).toBe('secret');
    expect(rotated.needsRotation(stored)).toBe(true);
    const fresh = rotated.rotate(stored, 'ctx');
    expect(fresh.startsWith('enc:v1:k2:')).toBe(true);
    expect(rotated.needsRotation(fresh)).toBe(false);
    expect(rotated.decrypt(fresh, 'ctx')).toBe('secret');
  });

  it('cannot decrypt after the old key is removed', () => {
    const stored = FieldCipher.fromEnv(
      env({ DATA_ENCRYPTION_KEYS: `k1:${key()}` }),
    ).encrypt('s', 'ctx');
    const other = FieldCipher.fromEnv(
      env({ DATA_ENCRYPTION_KEYS: `k9:${key()}` }),
    );
    expect(() => other.decrypt(stored, 'ctx')).toThrow(/unknown key id/);
  });

  it('rejects malformed key configuration', () => {
    expect(() =>
      FieldCipher.fromEnv(env({ DATA_ENCRYPTION_KEYS: 'k1:c2hvcnQ=' })),
    ).toThrow(/32 bytes/);
    expect(() =>
      FieldCipher.fromEnv(env({ DATA_ENCRYPTION_KEYS: 'nocolon' })),
    ).toThrow();
    expect(() =>
      FieldCipher.fromEnv(
        env({
          DATA_ENCRYPTION_KEYS: `k1:${key()}`,
          DATA_ENCRYPTION_KEY_ID: 'zz',
        }),
      ),
    ).toThrow(/not in DATA_ENCRYPTION_KEYS/);
  });

  it('requires a key in production, but derives a local one elsewhere', () => {
    expect(() => FieldCipher.fromEnv({ NODE_ENV: 'production' })).toThrow(
      /required in production/,
    );
    const dev = FieldCipher.fromEnv({
      NODE_ENV: 'development',
      JWT_REFRESH_SECRET: 'abc',
    });
    expect(dev.activeKeyId).toBe('dev');
    expect(dev.decrypt(dev.encrypt('v', 'c'), 'c')).toBe('v');
  });
});
