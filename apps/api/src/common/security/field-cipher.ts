import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'crypto';

/**
 * Application-level encryption for secrets stored in the database (Phase 22 S-04/S-24): integration
 * API keys, webhook secrets, TOTP secrets.
 *
 * - AES-256-GCM, a fresh 96-bit IV per value, authenticated.
 * - Keys are versioned. `DATA_ENCRYPTION_KEYS="2026a:<base64 32 bytes>,2026b:<...>"`;
 *   `DATA_ENCRYPTION_KEY_ID` names the one used to encrypt (default: the first). Old keys stay
 *   listed so old values still decrypt; re-encrypting under a new key is `rotate()`.
 * - The ciphertext is bound to a caller-supplied context string (where the value lives), so a value
 *   copied to another row/field fails authentication instead of decrypting there.
 * - Values look like `enc:v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url). Anything without that
 *   prefix is treated as legacy plaintext by `isEncrypted()`/`decryptIfEncrypted()`, which is what
 *   lets existing rows keep working until they are re-saved.
 * - In production a missing key is a hard error (see checkProductionConfig). Outside production a
 *   key is derived from JWT_REFRESH_SECRET so local development works with zero setup; that derived
 *   key id is "dev" and is logged once.
 */
const PREFIX = 'enc:v1:';

export class FieldCipher {
  private constructor(
    private readonly keys: Map<string, Buffer>,
    private readonly currentId: string,
  ) {}

  static parseKeys(raw: string): Map<string, Buffer> {
    const keys = new Map<string, Buffer>();
    for (const part of raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      const i = part.indexOf(':');
      if (i <= 0)
        throw new Error(
          'DATA_ENCRYPTION_KEYS entries must look like id:base64key',
        );
      const id = part.slice(0, i);
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id))
        throw new Error(`Invalid encryption key id "${id}"`);
      const key = Buffer.from(part.slice(i + 1), 'base64');
      if (key.length !== 32)
        throw new Error(
          `Encryption key "${id}" must be exactly 32 bytes (base64)`,
        );
      keys.set(id, key);
    }
    return keys;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): FieldCipher {
    const raw = env.DATA_ENCRYPTION_KEYS?.trim();
    if (raw) {
      const keys = FieldCipher.parseKeys(raw);
      if (keys.size === 0)
        throw new Error('DATA_ENCRYPTION_KEYS is set but empty');
      const currentId =
        env.DATA_ENCRYPTION_KEY_ID?.trim() || [...keys.keys()][0];
      if (!keys.has(currentId))
        throw new Error(
          `DATA_ENCRYPTION_KEY_ID "${currentId}" is not in DATA_ENCRYPTION_KEYS`,
        );
      return new FieldCipher(keys, currentId);
    }
    if (env.NODE_ENV === 'production') {
      throw new Error('DATA_ENCRYPTION_KEYS is required in production');
    }
    const seed = env.JWT_REFRESH_SECRET || 'alnajoum-local-development-only';
    const derived = Buffer.from(
      hkdfSync('sha256', seed, 'alnajoum-field-cipher', 'dev', 32),
    );
    return new FieldCipher(new Map([['dev', derived]]), 'dev');
  }

  private static instance: FieldCipher | undefined;
  /** Process-wide cipher built from the environment on first use. */
  static default(): FieldCipher {
    FieldCipher.instance ??= FieldCipher.fromEnv();
    return FieldCipher.instance;
  }
  static resetDefaultForTests(): void {
    FieldCipher.instance = undefined;
  }

  get activeKeyId(): string {
    return this.currentId;
  }

  static isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.keys.get(this.currentId)!,
      iv,
    );
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${this.currentId}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
  }

  decrypt(value: string, context: string): string {
    if (!FieldCipher.isEncrypted(value))
      throw new Error('Value is not encrypted');
    const [keyId, iv, tag, ct] = value.slice(PREFIX.length).split(':');
    const key = this.keys.get(keyId);
    if (!key || !iv || !tag || ct === undefined) {
      throw new Error(
        'Cannot decrypt value: unknown key id or malformed ciphertext',
      );
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Decrypts an encrypted value, passes legacy plaintext through unchanged. */
  decryptIfEncrypted(value: string, context: string): string {
    return FieldCipher.isEncrypted(value)
      ? this.decrypt(value, context)
      : value;
  }

  /**
   * A keyed, one-way fingerprint of an identifier (a passport number) so rows can be FOUND by exact value while the
   * value itself is stored encrypted. Normalised (letters and digits only, upper case) so "ab 123-456" and
   * "AB123456" match. It is an HMAC-SHA-256 under a key derived from the FIRST key listed in DATA_ENCRYPTION_KEYS,
   * not the active one, so the fingerprints stay valid when the active key is rotated: keep the first listed key
   * in the list for as long as indexed rows exist. It supports equality lookups only (no partial match).
   */
  blindIndex(value: string, context: string): string {
    const first = [...this.keys.values()][0];
    const key = Buffer.from(
      hkdfSync('sha256', first, 'alnajoum-blind-index', context, 32),
    );
    const normalised = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return createHmac('sha256', key).update(normalised).digest('hex');
  }

  /** True when the value is plaintext or encrypted under a key that is not the current one. */
  needsRotation(value: string): boolean {
    if (!FieldCipher.isEncrypted(value)) return true;
    return value.slice(PREFIX.length).split(':')[0] !== this.currentId;
  }

  /** Re-encrypts (or encrypts, if legacy plaintext) under the current key. */
  rotate(value: string, context: string): string {
    return this.encrypt(this.decryptIfEncrypted(value, context), context);
  }
}
