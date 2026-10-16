import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CHIP_TYPES = [
  'NTAG213',
  'NTAG215',
  'NTAG216',
  'NTAG424_DNA',
  'MIFARE_DESFIRE_EV2',
  'MIFARE_DESFIRE_EV3',
  'MIFARE_CLASSIC_1K',
  'OTHER',
] as const;
export const READER_ADAPTERS = [
  'WEB_NFC',
  'KEYBOARD_WEDGE',
  'PCSC_BRIDGE',
  'VENDOR_SDK',
  'ANDROID_APP',
  'MOCK',
] as const;

export class NfcProfileDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsIn(CHIP_TYPES) chipType!: (typeof CHIP_TYPES)[number];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) frequency?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) cardStock?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  readerModel?: string;
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  compatibilityNotes?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class NfcReaderDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) model?: string;
  @IsIn(READER_ADAPTERS) adapter!: (typeof READER_ADAPTERS)[number];
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) location?: string;
}

export class ReaderReportDto {
  @IsIn(['CONNECTED', 'DISCONNECTED', 'ERROR']) status!:
    'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) error?: string;
}

export class PrepareNfcDto {
  @IsOptional() @IsString() @MaxLength(40) profileId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) batch?: string;
  /** Record a keyed fingerprint of the chip's serial number (only if the company is allowed and wants to). */
  @IsOptional() @IsBoolean() recordUid?: boolean;
}

export class ConfirmEncodingDto {
  /** True when the writer reports the write finished. False records a failed attempt. */
  @IsBoolean() success!: boolean;
  /** What was read back from the chip after writing: the URL, or the bare reference. */
  @IsOptional() @IsString() @MaxLength(400) readBack?: string;
  /** The chip's serial number as read, in hex; kept only as a keyed fingerprint. */
  @IsOptional() @IsString() @MaxLength(40) uid?: string;
  /** Keep a keyed fingerprint of the serial number (the number itself is never stored). */
  @IsOptional() @IsBoolean() recordUid?: boolean;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) error?: string;
}

export class NfcVerifyDto {
  /** The NDEF payload read from the chip (URL or bare reference). */
  @IsString() @MaxLength(600) payload!: string;
  @IsOptional() @IsString() @MaxLength(40) readerId?: string;
  /** True only from the labelled mock reader. Refused in production. */
  @IsOptional() @IsBoolean() simulated?: boolean;
}

export class NfcUidVerifyDto {
  @IsString() @MaxLength(40) uid!: string;
  @IsOptional() @IsString() @MaxLength(40) readerId?: string;
  @IsOptional() @IsBoolean() simulated?: boolean;
}

export class NfcCombinedVerifyDto {
  @IsString() @MaxLength(600) qr!: string;
  @IsString() @MaxLength(600) nfc!: string;
  @IsOptional() @IsString() @MaxLength(40) readerId?: string;
  @IsOptional() @IsBoolean() simulated?: boolean;
}

export class BridgeVerifyDto {
  @IsString() @MaxLength(600) payload!: string;
}
