import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizePhoneNumber } from './phone-number.util';

const CODE_LENGTH = 6;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Phase 14 spec #7/#8 — links a WhatsApp conversation to an existing
 * Customer account before any sensitive data (booking details,
 * documents, payment info) is shown over the channel. Mirrors
 * TwoFactorService's own discipline: the code is hashed at rest (never
 * stored or logged in plaintext), short-lived, single-use, attempt-
 * limited, and every outcome is audited — but this is a distinct
 * mechanism from 2FA (which authenticates an already-known staff/
 * customer login session), not a reuse of it, since this is verifying
 * "this phone number belongs to this existing customer", a different
 * claim.
 */
@Injectable()
export class WhatsAppOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private generateCode(): string {
    return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  }

  /** Creates a new challenge and returns the plaintext code — the ONLY
   * place it ever exists outside argon2's hash. The caller is
   * responsible for sending it over WhatsApp; this method itself never
   * logs or persists the plaintext. */
  async requestOtp(phoneNumber: string, customerId?: string): Promise<string> {
    const normalized = normalizePhoneNumber(phoneNumber);

    const recent = await this.prisma.whatsAppOtpChallenge.findFirst({
      where: { phoneNumber: normalized },
      orderBy: { createdAt: 'desc' },
    });
    if (
      recent &&
      Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000
    ) {
      throw new HttpException(
        'Please wait before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const codeHash = await argon2.hash(code);

    await this.prisma.whatsAppOtpChallenge.create({
      data: {
        phoneNumber: normalized,
        customerId,
        codeHash,
        expiresAt: new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000),
      },
    });

    await this.auditService.record({
      action: 'whatsapp.otp.requested',
      entityType: 'WhatsAppOtpChallenge',
      metadata: { phoneNumber: normalized },
    });

    return code;
  }

  /** Verifies against the most recent, still-valid challenge for this
   * phone number. Locks out further attempts on that challenge once
   * MAX_ATTEMPTS is reached — the customer must request a fresh code,
   * not keep guessing against the same one (brute-force protection, spec
   * #8). Never logs the submitted code, correct or not. */
  async verifyOtp(phoneNumber: string, code: string): Promise<boolean> {
    const normalized = normalizePhoneNumber(phoneNumber);

    const challenge = await this.prisma.whatsAppOtpChallenge.findFirst({
      where: { phoneNumber: normalized, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      await this.auditService.record({
        action: 'whatsapp.otp.verify_failed',
        entityType: 'WhatsAppOtpChallenge',
        metadata: { phoneNumber: normalized, reason: 'expired_or_missing' },
      });
      return false;
    }

    if (challenge.attempts >= MAX_ATTEMPTS) {
      await this.auditService.record({
        action: 'whatsapp.otp.verify_failed',
        entityType: 'WhatsAppOtpChallenge',
        entityId: challenge.id,
        metadata: { phoneNumber: normalized, reason: 'locked_out' },
      });
      return false;
    }

    const valid = await argon2
      .verify(challenge.codeHash, code)
      .catch(() => false);

    await this.prisma.whatsAppOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: { increment: 1 },
        ...(valid && { consumedAt: new Date() }),
      },
    });

    await this.auditService.record({
      action: valid ? 'whatsapp.otp.verified' : 'whatsapp.otp.verify_failed',
      entityType: 'WhatsAppOtpChallenge',
      entityId: challenge.id,
      metadata: {
        phoneNumber: normalized,
        ...(!valid && { reason: 'wrong_code' }),
      },
    });

    if (valid) {
      await this.prisma.customer.updateMany({
        where: { id: challenge.customerId ?? undefined },
        data: { whatsappVerifiedAt: new Date() },
      });
    }

    return valid;
  }
}
