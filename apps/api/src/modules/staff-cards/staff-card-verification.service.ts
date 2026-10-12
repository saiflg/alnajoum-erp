import { Injectable } from '@nestjs/common';
import { Prisma, StaffIdCardStatus } from '@prisma/client';
import { FieldCipher } from '../../common/security/field-cipher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STAFF_PHOTO_NAMESPACE, readCardImage } from './staff-card-images';
import {
  effectiveStatus,
  isPlausibleToken,
  normaliseCardNumber,
  toVerificationResult,
  VERIFICATION_LABELS,
  VerificationResult,
} from './staff-card.policy';

export type ScanMethod =
  'QR' | 'PUBLIC_LINK' | 'MANUAL_STAFF_ID' | 'MANUAL_REFERENCE';

export interface ScanContext {
  method: ScanMethod;
  /** Set when a signed-in staff member ran the check (the scanner page). */
  scannedByIdentityId?: string;
  /** The signed-in scanner's company, so an unrecognised code still shows up in their own history. */
  scannerCompanyId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * What a verifier is told. Deliberately thin: identity details are returned only for a card that is VALID, because
 * that is the only case in which a person is being vouched for. For every other result the answer is the status, the
 * company name and what to do next.
 */
export interface Verification {
  result: VerificationResult;
  label: string;
  message: string;
  checkedAt: string;
  company: { name: string } | null;
  card: { number: string; validUntil: string | null } | null;
  staff: {
    fullName: string;
    staffId: string;
    department: string | null;
    jobTitle: string | null;
    branch: string | null;
    hasPhoto: boolean;
  } | null;
  /**
   * Only for a signed-in scanner and only for a VALID card with a photograph: where to fetch the photograph (the
   * scanner looked the card up by staff id or card number, so it has no link of its own to build from).
   */
  photoPath?: string;
}

const MESSAGES: Record<VerificationResult, string> = {
  VALID: 'This card is genuine and currently valid.',
  EXPIRED:
    'This card has expired. Do not accept it as identification; ask the holder to contact the office.',
  SUSPENDED:
    'This card is suspended. Do not accept it as identification and contact the office.',
  REVOKED:
    'This card has been withdrawn. Do not accept it as identification and contact the office.',
  REPLACED:
    'This card was replaced by a newer one. Ask the holder for their current card.',
  INVALID:
    'This card was not recognised, or has not been activated. Do not accept it as identification.',
};

const CARD_INCLUDE = {
  staff: {
    select: {
      employeeCode: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      department: true,
      isActive: true,
      photoFilename: true,
      branch: { select: { name: true } },
      company: { select: { name: true, tradingName: true } },
    },
  },
} satisfies Prisma.StaffIdCardInclude;

type CardRow = Prisma.StaffIdCardGetPayload<{ include: typeof CARD_INCLUDE }>;

@Injectable()
export class StaffCardVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Accepts a scanned verification link or a bare token and returns the token, or null for anything else. */
  parseScanned(value: string): string | null {
    const v = value.trim();
    if (isPlausibleToken(v)) return v;
    const m = /\/verify\/card\/([A-Za-z0-9_-]{22})(?:[/?#].*)?$/.exec(v);
    return m ? m[1] : null;
  }

  // ----------------------------------------------------------------------------------------------- by token

  async verifyToken(token: string, ctx: ScanContext): Promise<Verification> {
    if (!isPlausibleToken(token)) {
      // Malformed input never reaches the database, and gets exactly the answer an unknown code gets.
      await this.record(null, 'INVALID', ctx, token);
      return this.build('INVALID', null);
    }
    const card = await this.prisma.staffIdCard.findUnique({
      where: { verificationToken: token },
      include: CARD_INCLUDE,
    });
    return this.finish(card, ctx, token);
  }

  // ----------------------------------------------------------------------------------------------- manual (signed in)

  async verifyStaffId(
    employeeCode: string,
    ctx: ScanContext,
    tenant?: string,
  ): Promise<Verification> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        employeeCode: employeeCode.trim(),
        ...(tenant !== undefined && { companyId: tenant }),
      },
      select: { id: true },
    });
    const card = staff
      ? await this.prisma.staffIdCard.findFirst({
          where: { staffId: staff.id },
          // The card currently in use if there is one, otherwise the newest.
          orderBy: [{ createdAt: 'desc' }],
          include: CARD_INCLUDE,
        })
      : null;
    return this.finish(card, ctx, employeeCode);
  }

  async verifyReference(
    reference: string,
    ctx: ScanContext,
    tenant?: string,
  ): Promise<Verification> {
    const number = normaliseCardNumber(reference);
    const card = await this.prisma.staffIdCard.findFirst({
      where: {
        cardNumber: number,
        ...(tenant !== undefined && { companyId: tenant }),
      },
      include: CARD_INCLUDE,
    });
    return this.finish(card, ctx, number);
  }

  // ----------------------------------------------------------------------------------------------- photo

  /** The photograph of a card, only while the card is valid: a revoked card exposes nothing. */
  async photoForToken(token: string): Promise<Buffer | null> {
    if (!isPlausibleToken(token)) return null;
    const card = await this.prisma.staffIdCard.findUnique({
      where: { verificationToken: token },
      include: CARD_INCLUDE,
    });
    if (!card) return null;
    const eff = effectiveStatus(card, card.staff.isActive);
    if (eff !== 'ACTIVE') return null;
    return readCardImage(STAFF_PHOTO_NAMESPACE, card.staff.photoFilename);
  }

  // ----------------------------------------------------------------------------------------------- internals

  private async finish(
    card: CardRow | null,
    ctx: ScanContext,
    presented: string,
  ): Promise<Verification> {
    const eff: StaffIdCardStatus | null = card
      ? effectiveStatus(card, card.staff.isActive)
      : null;
    const result: VerificationResult = eff
      ? toVerificationResult(eff)
      : 'INVALID';
    await this.record(card, result, ctx, presented);
    return this.build(result, card, ctx);
  }

  private build(
    result: VerificationResult,
    card: CardRow | null,
    ctx?: ScanContext,
  ): Verification {
    const base: Verification = {
      result,
      label: VERIFICATION_LABELS[result],
      message: MESSAGES[result],
      checkedAt: new Date().toISOString(),
      company: null,
      card: null,
      staff: null,
    };
    if (!card || result === 'INVALID') return base;
    const company = card.staff.company.tradingName ?? card.staff.company.name;
    base.company = { name: company };
    if (result !== 'VALID') return base; // status only: nothing that identifies a person
    base.card = {
      number: card.cardNumber,
      validUntil: card.expiresAt?.toISOString() ?? null,
    };
    base.staff = {
      fullName: `${card.staff.firstName} ${card.staff.lastName}`,
      staffId: card.staff.employeeCode,
      department: card.staff.department,
      jobTitle: card.staff.jobTitle,
      branch: card.staff.branch?.name ?? null,
      hasPhoto: !!card.staff.photoFilename,
    };
    if (ctx?.scannedByIdentityId && card.staff.photoFilename)
      base.photoPath = `/public/staff-cards/${card.verificationToken}/photo`;
    return base;
  }

  /** Every attempt is logged, with a keyed fingerprint of the client address instead of the address. */
  private async record(
    card: CardRow | null,
    result: VerificationResult,
    ctx: ScanContext,
    presented: string,
  ): Promise<void> {
    try {
      await this.prisma.staffIdCardScan.create({
        data: {
          cardId: card?.id ?? null,
          companyId: card?.companyId ?? ctx.scannerCompanyId ?? null,
          result,
          method: ctx.method,
          scannedByIdentityId: ctx.scannedByIdentityId,
          ipFingerprint: ctx.ip
            ? FieldCipher.default().keyedHash(ctx.ip, 'staff-card-scan-ip')
            : null,
          userAgent: ctx.userAgent?.slice(0, 200),
          // Enough to see a scraper walking through codes, never a whole usable token.
          queryHint: presented.slice(0, 6),
        },
      });
    } catch {
      // A logging failure must never turn a safe "not valid" answer into an error page.
    }
  }
}
