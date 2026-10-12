import { randomBytes, randomInt } from 'crypto';
import { StaffIdCardStatus } from '@prisma/client';

/**
 * The rules of the staff identification card lifecycle, kept free of the database so they can be tested exhaustively.
 *
 *   PENDING --activate--> ACTIVE --suspend--> SUSPENDED --reinstate--> ACTIVE
 *   ACTIVE  --(expiry date passes)--> EXPIRED --renew--> ACTIVE
 *   PENDING | ACTIVE | SUSPENDED | EXPIRED --revoke--> REVOKED          (final)
 *   PENDING | ACTIVE | SUSPENDED | EXPIRED --replace--> REPLACED        (final; a new card is issued)
 */
export type CardAction =
  'ACTIVATE' | 'RENEW' | 'SUSPEND' | 'REINSTATE' | 'REVOKE' | 'REPLACE';

/** What a verifier is told. INVALID covers "no such card" and "not activated yet". */
export type VerificationResult =
  'VALID' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'REPLACED' | 'INVALID';

export const VERIFICATION_LABELS: Record<VerificationResult, string> = {
  VALID: 'VALID — ACTIVE CARD',
  EXPIRED: 'EXPIRED — CARD EXPIRED',
  SUSPENDED: 'SUSPENDED — CARD SUSPENDED',
  REVOKED: 'REVOKED — CARD REVOKED',
  REPLACED: 'REPLACED — OLD CARD REPLACED',
  INVALID: 'INVALID — CARD NOT RECOGNIZED',
};

/** A card that still belongs to a staff member's current identification (at most one per person). */
export const LIVE_STATUSES: readonly StaffIdCardStatus[] = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
];

const TRANSITIONS: Record<CardAction, readonly StaffIdCardStatus[]> = {
  ACTIVATE: ['PENDING'],
  RENEW: ['ACTIVE', 'EXPIRED'],
  SUSPEND: ['ACTIVE'],
  REINSTATE: ['SUSPENDED'],
  REVOKE: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'],
  REPLACE: ['PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED'],
};

export function canApply(
  action: CardAction,
  effective: StaffIdCardStatus,
): boolean {
  return TRANSITIONS[action].includes(effective);
}

/** Actions that need a written reason, because they take something away or override a control. */
export const REASON_REQUIRED: readonly CardAction[] = [
  'SUSPEND',
  'REINSTATE',
  'REVOKE',
  'REPLACE',
];

export interface CardLike {
  status: StaffIdCardStatus;
  expiresAt: Date | null;
}

/**
 * The status a verifier should act on, which can differ from the stored one:
 *  - an ACTIVE card whose expiry date has passed is EXPIRED, even if the nightly sweep has not recorded that yet;
 *  - a card of a staff member who has been deactivated is no longer valid, whatever its stored state.
 */
export function effectiveStatus(
  card: CardLike,
  staffIsActive: boolean,
  now: Date = new Date(),
): StaffIdCardStatus {
  if (card.status === 'ACTIVE' || card.status === 'SUSPENDED') {
    if (!staffIsActive) return 'REVOKED';
  }
  if (
    card.status === 'ACTIVE' &&
    card.expiresAt &&
    card.expiresAt.getTime() <= now.getTime()
  ) {
    return 'EXPIRED';
  }
  return card.status;
}

export function toVerificationResult(
  effective: StaffIdCardStatus,
): VerificationResult {
  switch (effective) {
    case 'ACTIVE':
      return 'VALID';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'SUSPENDED':
      return 'SUSPENDED';
    case 'REVOKED':
      return 'REVOKED';
    case 'REPLACED':
      return 'REPLACED';
    case 'PENDING':
    default:
      // Printed but not yet handed over: it does not identify anyone.
      return 'INVALID';
  }
}

// ---------------------------------------------------------------------------------------------- identifiers

/** 128 random bits, URL-safe: 22 characters. Unguessable, so verification links cannot be enumerated. */
export function newVerificationToken(): string {
  return randomBytes(16).toString('base64url');
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** Cheap shape test, so obviously wrong input never reaches the database. */
export function isPlausibleToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value);
}

// Crockford-style alphabet without I, L, O, U: readable on a card, hard to misread on the phone.
const CARD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A printed, human-readable number such as ALN-C-7K3Q-9M2X. Uniqueness is enforced by the database. */
export function newCardNumber(): string {
  const pick = () =>
    Array.from(
      { length: 4 },
      () => CARD_ALPHABET[randomInt(CARD_ALPHABET.length)],
    ).join('');
  return `ALN-C-${pick()}-${pick()}`;
}

/** A reference typed by hand may include spaces, lower case or different dashes. */
export function normaliseCardNumber(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[‐-―\s_]+/g, '-');
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month would roll into March: clamp to the last day of the intended month.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}
