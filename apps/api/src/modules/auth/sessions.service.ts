import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Phase 11 spec #16 — presents RefreshToken as a "session" rather than
 * introducing a duplicate Session model; RefreshToken already carried
 * device/browser (userAgent), IP, issued/expiry/revoked times before
 * this phase — lastActivityAt (bumped by JwtAccessStrategy) is the one
 * genuinely new signal.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private toSession(
    row: {
      id: string;
      createdByIp: string | null;
      userAgent: string | null;
      createdAt: Date;
      lastActivityAt: Date | null;
      expiresAt: Date;
      revokedAt: Date | null;
    },
    currentSessionId: string | null,
  ) {
    const now = new Date();
    return {
      id: row.id,
      ipAddress: row.createdByIp,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
      expiresAt: row.expiresAt,
      status: row.revokedAt
        ? 'REVOKED'
        : row.expiresAt < now
          ? 'EXPIRED'
          : 'ACTIVE',
      isCurrent: row.id === currentSessionId,
    };
  }

  /** A caller's own sessions — spec #16's "view active sessions". Includes
   * revoked/expired ones too (capped, newest first) so "what happened to
   * my session" is answerable, not just "what's active right now". */
  async listForIdentity(identityId: string, currentSessionId: string | null) {
    const rows = await this.prisma.refreshToken.findMany({
      where: { identityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.toSession(row, currentSessionId));
  }

  private async getOwnedSession(identityId: string, sessionId: string) {
    const row = await this.prisma.refreshToken.findUnique({
      where: { id: sessionId },
    });
    if (!row || row.identityId !== identityId) {
      // NotFound, not Forbidden — never confirm another identity's
      // session id exists, same reasoning as cross-tenant customer reads.
      throw new NotFoundException('Session not found');
    }
    return row;
  }

  async revoke(identityId: string, sessionId: string, actorIdentityId: string) {
    const row = await this.getOwnedSession(identityId, sessionId);
    if (row.revokedAt) {
      return this.toSession(row, null);
    }
    const updated = await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.auditService.record({
      identityId: actorIdentityId,
      action: 'security.session_revoked',
      entityType: 'RefreshToken',
      entityId: sessionId,
      metadata: { ownerIdentityId: identityId },
    });
    return this.toSession(updated, null);
  }

  /** "Terminate all other sessions" — spec #16. Never touches the caller's
   * own current session (currentSessionId), so this can't log the caller
   * themselves out. */
  async revokeAllOthers(
    identityId: string,
    currentSessionId: string | null,
    actorIdentityId: string,
  ): Promise<{ revokedCount: number }> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        identityId,
        revokedAt: null,
        ...(currentSessionId && { id: { not: currentSessionId } }),
      },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      await this.auditService.record({
        identityId: actorIdentityId,
        action: 'security.session_revoked',
        entityType: 'RefreshToken',
        metadata: {
          ownerIdentityId: identityId,
          bulk: true,
          count: result.count,
        },
      });
    }
    return { revokedCount: result.count };
  }

  /** Admin override (USER.MANAGE_SESSIONS) — revoking someone else's
   * session. Distinctly audited from a self-service revoke. */
  async adminRevoke(identityId: string, sessionId: string, adminId: string) {
    const row = await this.getOwnedSession(identityId, sessionId);
    if (row.revokedAt) {
      return this.toSession(row, null);
    }
    const updated = await this.prisma.refreshToken.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.auditService.record({
      identityId: adminId,
      action: 'security.session_revoked',
      entityType: 'RefreshToken',
      entityId: sessionId,
      metadata: { ownerIdentityId: identityId, revokedByAdmin: true },
    });
    return this.toSession(updated, null);
  }
}
