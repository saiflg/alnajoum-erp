import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const RECOVERY_CODE_COUNT = 8;
const ISSUER = 'Alnajoum Travel Agency';

/**
 * Phase 11 spec #15 — TOTP two-factor authentication. Identity.
 * twoFactorEnabled/twoFactorSecret already existed in the schema from an
 * earlier phase but nothing ever read or wrote them; this service is
 * that missing piece, plus the TwoFactorRecoveryCode model this phase
 * adds for the "regenerate/revoke recovery codes" requirement those two
 * columns alone can't satisfy.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Step 1 of setup — generates a secret and a scannable QR code, but
   * does NOT enable 2FA yet. The secret is stored immediately (so
   * verifyAndEnable can read it back) but twoFactorEnabled stays false
   * until the identity proves they actually captured the code by
   * submitting a valid TOTP in verifyAndEnable — otherwise a client that
   * never finished setup would silently lock itself into "enabled with a
   * secret nobody has."
   */
  async generateSetup(identityId: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity) throw new NotFoundException('Identity not found');
    if (identity.twoFactorEnabled) {
      throw new ConflictException(
        'Two-factor authentication is already enabled — disable it first to reconfigure.',
      );
    }

    const secret = authenticator.generateSecret();
    await this.prisma.identity.update({
      where: { id: identityId },
      data: { twoFactorSecret: secret },
    });

    const otpauthUrl = authenticator.keyuri(identity.email, ISSUER, secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(5)
        .toString('hex')
        .toUpperCase()
        .match(/.{1,5}/g)!
        .join('-'),
    );
  }

  private async storeRecoveryCodes(
    identityId: string,
    codes: string[],
  ): Promise<void> {
    // Old codes are gone the moment a new batch is generated — spec #15's
    // "do not display them again" implies the old batch shouldn't remain
    // silently valid alongside a new one either.
    await this.prisma.twoFactorRecoveryCode.deleteMany({
      where: { identityId },
    });
    await this.prisma.twoFactorRecoveryCode.createMany({
      data: await Promise.all(
        codes.map(async (code) => ({
          identityId,
          codeHash: await argon2.hash(code),
        })),
      ),
    });
  }

  /** Step 2 of setup — proves the identity captured the secret, flips
   * twoFactorEnabled on, and returns the one-time recovery codes. */
  async verifyAndEnable(identityId: string, code: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity?.twoFactorSecret) {
      throw new BadRequestException(
        'No pending two-factor setup — call the setup endpoint first.',
      );
    }
    const valid = authenticator.verify({
      token: code,
      secret: identity.twoFactorSecret,
    });
    if (!valid) {
      throw new UnauthorizedException('Invalid authenticator code');
    }

    await this.prisma.identity.update({
      where: { id: identityId },
      data: { twoFactorEnabled: true },
    });

    const recoveryCodes = this.generateRecoveryCodes();
    await this.storeRecoveryCodes(identityId, recoveryCodes);

    await this.auditService.record({
      identityId,
      action: 'security.2fa_enabled',
      entityType: 'Identity',
      entityId: identityId,
    });

    return { enabled: true, recoveryCodes };
  }

  /** Verifies a login-time code — TOTP first, falling back to an unused
   * recovery code (consumed on success, same as any single-use code). */
  async verifyChallenge(identityId: string, code: string): Promise<boolean> {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity?.twoFactorEnabled || !identity.twoFactorSecret) {
      return false;
    }

    if (
      authenticator.verify({ token: code, secret: identity.twoFactorSecret })
    ) {
      return true;
    }

    const unusedCodes = await this.prisma.twoFactorRecoveryCode.findMany({
      where: { identityId, usedAt: null },
    });
    for (const recoveryCode of unusedCodes) {
      if (await argon2.verify(recoveryCode.codeHash, code)) {
        await this.prisma.twoFactorRecoveryCode.update({
          where: { id: recoveryCode.id },
          data: { usedAt: new Date() },
        });
        await this.auditService.record({
          identityId,
          action: 'security.2fa_recovery_code_used',
          entityType: 'TwoFactorRecoveryCode',
          entityId: recoveryCode.id,
        });
        return true;
      }
    }
    return false;
  }

  /** Self-service disable — requires a valid current TOTP/recovery code,
   * never just a password, so a stolen session alone can't turn off 2FA. */
  async disable(identityId: string, code: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity?.twoFactorEnabled) {
      throw new ConflictException('Two-factor authentication is not enabled');
    }
    const valid = await this.verifyChallenge(identityId, code);
    if (!valid) {
      throw new UnauthorizedException('Invalid authenticator or recovery code');
    }
    await this.doDisable(identityId, 'security.2fa_disabled');
    return { disabled: true };
  }

  /** Admin override (USER.MANAGE_2FA) — bypasses the code requirement for
   * an identity that's lost every device and every recovery code. Always
   * distinctly audited as an override, per spec #34. */
  async adminDisable(identityId: string, adminIdentityId: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity?.twoFactorEnabled) {
      throw new ConflictException('Two-factor authentication is not enabled');
    }
    await this.doDisable(identityId, 'security.2fa_disabled_by_admin', {
      overriddenByIdentityId: adminIdentityId,
    });
    return { disabled: true };
  }

  private async doDisable(
    identityId: string,
    auditAction: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.identity.update({
      where: { id: identityId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    await this.prisma.twoFactorRecoveryCode.deleteMany({
      where: { identityId },
    });
    await this.auditService.record({
      identityId,
      action: auditAction,
      entityType: 'Identity',
      entityId: identityId,
      metadata,
    });
  }

  /** Requires a valid current code first — a stolen session shouldn't be
   * able to mint a fresh batch of recovery codes on its own either. */
  async regenerateRecoveryCodes(identityId: string, code: string) {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId },
    });
    if (!identity?.twoFactorEnabled) {
      throw new ConflictException('Two-factor authentication is not enabled');
    }
    const valid = await this.verifyChallenge(identityId, code);
    if (!valid) {
      throw new UnauthorizedException('Invalid authenticator or recovery code');
    }
    const recoveryCodes = this.generateRecoveryCodes();
    await this.storeRecoveryCodes(identityId, recoveryCodes);
    await this.auditService.record({
      identityId,
      action: 'security.2fa_recovery_codes_regenerated',
      entityType: 'Identity',
      entityId: identityId,
    });
    return { recoveryCodes };
  }
}
