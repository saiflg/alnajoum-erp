import { randomBytes } from 'node:crypto';

/**
 * NFC helpers that need no hardware and no database: the NDEF record put on a card, what each chip can honestly do,
 * and the opaque reference that links a chip to its server-side card record.
 *
 * Sources: NFC Forum NDEF Technical Specification and URI Record Type Definition (a short record, TNF 0x01 well-known,
 * type "U", identifier code 0x04 = "https://"), NFC Forum Type 2 Tag TLV (0x03 NDEF message, 0xFE terminator), and the
 * NXP NTAG213/215/216 data sheets for user memory sizes. Nothing here is a vendor-specific command.
 */

export type ChipType =
  | 'NTAG213'
  | 'NTAG215'
  | 'NTAG216'
  | 'NTAG424_DNA'
  | 'MIFARE_DESFIRE_EV2'
  | 'MIFARE_DESFIRE_EV3'
  | 'MIFARE_CLASSIC_1K'
  | 'OTHER';

export interface ChipCapability {
  label: string;
  /** Bytes available for the NDEF message, when it is a plain Type 2 tag we can size; null when unknown. */
  userMemoryBytes: number | null;
  /** Can the chip carry a plain NDEF URI record that a phone reads? */
  ndef: boolean;
  /** Does the chip itself support cryptographic authentication that this system could use WITH the vendor SDK? */
  cryptoCapable: boolean;
  /** What this system actually implements for the chip. Always the opaque-reference check today. */
  implemented: 'OPAQUE_REFERENCE';
  warning?: string;
}

export const CHIP_CAPABILITIES: Record<ChipType, ChipCapability> = {
  NTAG213: {
    label: 'NXP NTAG213',
    userMemoryBytes: 144,
    ndef: true,
    cryptoCapable: false,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'A plain tag: its contents and serial number can be copied onto another tag. Treat a tap as a convenient lookup, not as proof of identity.',
  },
  NTAG215: {
    label: 'NXP NTAG215',
    userMemoryBytes: 504,
    ndef: true,
    cryptoCapable: false,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'A plain tag: its contents and serial number can be copied onto another tag.',
  },
  NTAG216: {
    label: 'NXP NTAG216',
    userMemoryBytes: 888,
    ndef: true,
    cryptoCapable: false,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'A plain tag: its contents and serial number can be copied onto another tag.',
  },
  NTAG424_DNA: {
    label: 'NXP NTAG 424 DNA',
    userMemoryBytes: 256,
    ndef: true,
    cryptoCapable: true,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'Supports AES-based secure messaging (SUN), but that needs NXP’s documented procedure, per-card keys and key custody. Not implemented here: used as an opaque-reference tag only.',
  },
  MIFARE_DESFIRE_EV2: {
    label: 'NXP MIFARE DESFire EV2',
    userMemoryBytes: null,
    ndef: true,
    cryptoCapable: true,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'Supports AES mutual authentication, but that needs the manufacturer SDK, per-card keys and key custody. Not implemented here: used as an opaque-reference card only.',
  },
  MIFARE_DESFIRE_EV3: {
    label: 'NXP MIFARE DESFire EV3',
    userMemoryBytes: null,
    ndef: true,
    cryptoCapable: true,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'Supports AES mutual authentication, but that needs the manufacturer SDK, per-card keys and key custody. Not implemented here: used as an opaque-reference card only.',
  },
  MIFARE_CLASSIC_1K: {
    label: 'MIFARE Classic 1K',
    userMemoryBytes: null,
    ndef: false,
    cryptoCapable: false,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'Not recommended: its Crypto1 protection is broken and many phones cannot read it. Choose NTAG or DESFire.',
  },
  OTHER: {
    label: 'Other chip',
    userMemoryBytes: null,
    ndef: false,
    cryptoCapable: false,
    implemented: 'OPAQUE_REFERENCE',
    warning:
      'Unknown capabilities. Verify compatibility with the reader, the phone and the SDK before buying cards.',
  },
};

// ------------------------------------------------------------------------------------------------ reference

/** 128 random bits, base64url: 22 characters. Independent of the QR token. */
export const REFERENCE_LENGTH = 22;
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function newNfcReference(): string {
  return randomBytes(16).toString('base64url');
}

export function isPlausibleReference(v: string): boolean {
  return REFERENCE_PATTERN.test(v);
}

export function nfcUrl(origin: string, reference: string): string {
  return `${origin.replace(/\/+$/, '')}/verify/nfc/${reference}`;
}

/** Accepts the full verification URL as read from the chip, or the bare reference. Anything else is null. */
export function referenceFromPayload(value: string): string | null {
  const v = value.trim();
  if (isPlausibleReference(v)) return v;
  const m = /\/verify\/nfc\/([A-Za-z0-9_-]{22})(?:[/?#].*)?$/.exec(v);
  return m ? m[1] : null;
}

// ------------------------------------------------------------------------------------------------ NDEF

const URI_PREFIXES: [number, string][] = [
  [0x04, 'https://'],
  [0x03, 'http://'],
];

/** One NDEF short record: a well-known URI record. Throws for a URL that cannot be written as one. */
export function buildUriNdef(url: string): Buffer {
  // https only - except an address on this very computer, which exists only while developing and is refused in
  // production by the service that calls this.
  const https = /^https:\/\//i.test(url);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url);
  if (!https && !local)
    throw new Error('Only https:// addresses are written to cards.');
  const rest = Buffer.from(url.slice(https ? 'https://'.length : 'http://'.length), 'utf8');
  const payload = Buffer.concat([Buffer.from([https ? 0x04 : 0x03]), rest]);
  if (payload.length > 255)
    throw new Error('The address is too long for a short NDEF record.');
  // 0xD1 = MB | ME | SR | TNF 0x01 (NFC Forum well-known type); type length 1; payload length; type "U".
  return Buffer.concat([
    Buffer.from([0xd1, 0x01, payload.length, 0x55]),
    payload,
  ]);
}

/** Wraps an NDEF message in the Type 2 Tag TLV structure used when writing raw tag memory (NTAG). */
export function wrapType2Tlv(ndef: Buffer): Buffer {
  const len =
    ndef.length < 0xff
      ? Buffer.from([ndef.length])
      : Buffer.from([0xff, (ndef.length >> 8) & 0xff, ndef.length & 0xff]);
  return Buffer.concat([Buffer.from([0x03]), len, ndef, Buffer.from([0xfe])]);
}

/** Reads the URI from a single-record NDEF message, as written by buildUriNdef. Null when it is anything else. */
export function parseUriNdef(message: Buffer): string | null {
  if (message.length < 5) return null;
  const header = message[0];
  const shortRecord = (header & 0x10) !== 0;
  const tnf = header & 0x07;
  if (
    !shortRecord ||
    tnf !== 0x01 ||
    message[1] !== 0x01 ||
    message[3] !== 0x55
  )
    return null;
  const payloadLength = message[2];
  const payload = message.subarray(4, 4 + payloadLength);
  if (payload.length !== payloadLength || payload.length < 1) return null;
  const prefix = URI_PREFIXES.find(([code]) => code === payload[0]);
  if (!prefix) return null;
  return prefix[1] + payload.subarray(1).toString('utf8');
}

export interface EncodingPlan {
  url: string;
  ndefHex: string;
  type2TlvHex: string;
  bytes: number;
  fits: boolean | null;
}

/** What has to be written to a chip, and whether it fits. `fits` is null when the chip's size is not known. */
export function planEncoding(url: string, chip: ChipType): EncodingPlan {
  const ndef = buildUriNdef(url);
  const tlv = wrapType2Tlv(ndef);
  const cap = CHIP_CAPABILITIES[chip];
  return {
    url,
    ndefHex: ndef.toString('hex'),
    type2TlvHex: tlv.toString('hex'),
    bytes: tlv.length,
    fits:
      cap.userMemoryBytes === null ? null : tlv.length <= cap.userMemoryBytes,
  };
}

/** Masked chip serial for display: only the last byte. */
export function uidHint(uidHex: string): string {
  const clean = normaliseUid(uidHex);
  return clean ? `…${clean.slice(-2)}` : '';
}

/** Upper-case hex without separators; null if it is not a 4, 7 or 10 byte serial number. */
export function normaliseUid(raw: string): string | null {
  const v = raw.replace(/[\s:.-]/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(v)) return null;
  return [8, 14, 20].includes(v.length) ? v : null;
}
