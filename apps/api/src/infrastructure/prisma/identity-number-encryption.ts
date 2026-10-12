import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldCipher } from '../../common/security/field-cipher';

/**
 * Passport numbers are encrypted at rest (Phase 24, S-24 follow-up).
 *
 * One place does it, so the 20 files that read or write a passport number keep working unchanged: this Prisma
 * client extension encrypts any `passportNumber` / `applicantPassportNumber` value on its way into the database and
 * decrypts it on its way out, wherever it sits in the data (a booking with nested passengers, a registration with
 * nested pilgrims, a customer profile). The ciphertext is AES-256-GCM with a fresh IV per value (FieldCipher).
 *
 *  - Legacy plaintext rows keep working: a value without the `enc:v1:` prefix is returned as it is, and is sealed by
 *    the startup migration (identity-number-migration.ts) and whenever the row is next saved.
 *  - You cannot LIKE-search ciphertext. The one place staff search by passport (dashboard search) uses an exact-match
 *    "blind index" on the customer row instead: a keyed hash of the normalised number (FieldCipher.blindIndex). The
 *    fingerprint column is never returned to callers.
 *  - Conditions in a `where` are NOT rewritten, so a filter on these fields only works through the blind index.
 */
export const IDENTITY_NUMBER_FIELDS: ReadonlySet<string> = new Set([
  'passportNumber',
  'applicantPassportNumber',
]);

/** Every encrypted column: delegate name (camelCase model) → field. Used by the startup migration. */
export const IDENTITY_NUMBER_COLUMNS: readonly {
  model: string;
  delegate: string;
  field: string;
}[] = [
  { model: 'Customer', delegate: 'customer', field: 'passportNumber' },
  { model: 'FamilyMember', delegate: 'familyMember', field: 'passportNumber' },
  {
    model: 'FlightGroupPassenger',
    delegate: 'flightGroupPassenger',
    field: 'passportNumber',
  },
  {
    model: 'FlightBookingPassenger',
    delegate: 'flightBookingPassenger',
    field: 'passportNumber',
  },
  {
    model: 'HajjRegistrationPilgrim',
    delegate: 'hajjRegistrationPilgrim',
    field: 'passportNumber',
  },
  {
    model: 'UmrahRegistrationPilgrim',
    delegate: 'umrahRegistrationPilgrim',
    field: 'passportNumber',
  },
  {
    model: 'VisaApplication',
    delegate: 'visaApplication',
    field: 'applicantPassportNumber',
  },
  {
    model: 'CorporateTraveler',
    delegate: 'corporateTraveler',
    field: 'passportNumber',
  },
];

const CONTEXT = 'identity-number';
const INDEX_FIELD = 'passportNumberIndex';
const UNREADABLE = '[unreadable: encryption key not available]';
/** Keys whose contents are conditions, projections or ordering, never values being stored. */
const NOT_DATA = new Set([
  'where',
  'select',
  'include',
  'omit',
  'orderBy',
  'cursor',
  'by',
  'having',
  'distinct',
]);
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);

const logger = new Logger('IdentityNumberEncryption');

type Json = Record<string, unknown>;
const isPlain = (v: unknown): v is Json =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** The fingerprint to look a customer up by an exact passport number. */
export function passportSearchIndex(
  passportNumber: string,
  cipher: FieldCipher = FieldCipher.default(),
): string {
  return cipher.blindIndex(passportNumber, CONTEXT);
}

const seal = (value: unknown, cipher: FieldCipher): unknown => {
  if (typeof value === 'string')
    return FieldCipher.isEncrypted(value)
      ? value
      : cipher.encrypt(value, CONTEXT);
  if (isPlain(value) && typeof value.set === 'string')
    return { ...value, set: seal(value.set, cipher) };
  return value;
};

/** Seals identity numbers anywhere inside write data, without touching conditions or projections. */
function sealTree(node: unknown, cipher: FieldCipher): unknown {
  if (Array.isArray(node)) return node.map((n) => sealTree(n, cipher));
  if (!isPlain(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (NOT_DATA.has(key)) out[key] = value;
    else if (IDENTITY_NUMBER_FIELDS.has(key)) out[key] = seal(value, cipher);
    else out[key] = sealTree(value, cipher);
  }
  return out;
}

/** Keeps the customer's blind index in step with the passport number being written (computed from the plaintext). */
function indexCustomer(data: unknown, cipher: FieldCipher): unknown {
  if (Array.isArray(data)) return data.map((d) => indexCustomer(d, cipher));
  if (!isPlain(data) || !('passportNumber' in data)) return data;
  const raw = data.passportNumber;
  if (raw === undefined) return data; // Prisma treats undefined as "not provided"
  const plain =
    typeof raw === 'string'
      ? raw
      : isPlain(raw) && typeof raw.set === 'string'
        ? raw.set
        : null;
  if (plain !== null && FieldCipher.isEncrypted(plain)) return data; // already sealed: index was set when it was
  return {
    ...data,
    [INDEX_FIELD]: plain ? cipher.blindIndex(plain, CONTEXT) : null,
  };
}

/** The write arguments of one operation, with identity numbers sealed (and the customer index maintained). */
export function sealWriteArgs(
  model: string,
  operation: string,
  args: unknown,
  cipher: FieldCipher,
): unknown {
  if (!WRITE_OPERATIONS.has(operation) || !isPlain(args)) return args;
  const next: Json = { ...args };
  for (const key of ['data', 'create', 'update'] as const) {
    if (!(key in next)) continue;
    if (key === 'update' && operation !== 'upsert') continue;
    next[key] =
      model === 'Customer' ? indexCustomer(next[key], cipher) : next[key];
    next[key] = sealTree(next[key], cipher);
  }
  return next;
}

/** Opens identity numbers anywhere in a result and removes the blind index, which is for lookups only. */
export function openResult(node: unknown, cipher: FieldCipher): unknown {
  if (Array.isArray(node)) return node.map((n) => openResult(n, cipher));
  if (!isPlain(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === INDEX_FIELD) continue;
    if (IDENTITY_NUMBER_FIELDS.has(key) && typeof value === 'string') {
      try {
        out[key] = cipher.decryptIfEncrypted(value, CONTEXT);
      } catch (err) {
        logger.error(
          `Could not decrypt an identity number: ${(err as Error).message}`,
        );
        out[key] = UNREADABLE;
      }
    } else out[key] = openResult(value, cipher);
  }
  return out;
}

export function identityNumberEncryption(cipher: FieldCipher) {
  return Prisma.defineExtension({
    name: 'identity-number-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(
            sealWriteArgs(model, operation, args, cipher) as typeof args,
          );
          return openResult(result, cipher);
        },
      },
    },
  });
}
