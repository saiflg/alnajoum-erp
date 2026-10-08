import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export const BREAK_GLASS_MAX_MINUTES = 120;

/**
 * Emergency (break-glass) access: time-boxed, second-person-approved, fully audited.
 *
 *  1. A staff member requests a role for a stated reason and at most BREAK_GLASS_MAX_MINUTES.
 *  2. A SUPER_ADMIN who is NOT the requester approves it - only then is the role granted.
 *  3. The role is removed automatically when the time is up (a minute-granularity sweep; permissions are
 *     resolved per request, so removal takes effect on the next call), or earlier if someone revokes it.
 *
 * SUPER_ADMIN itself can never be granted this way, and a person cannot be granted a role they already hold
 * (the expiry sweep would otherwise remove a role they legitimately have).
 */
@Injectable()
export class BreakGlassService {
  private readonly logger = new Logger(BreakGlassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async request(
    input: { roleId: string; reason: string; minutes: number },
    actor: { identityId: string; companyId: string | null },
  ) {
    if (!actor.companyId)
      throw new BadRequestException(
        'Your account is not attached to a company',
      );
    if (!input.reason || input.reason.trim().length < 10) {
      throw new BadRequestException(
        'Explain why access is needed (at least 10 characters)',
      );
    }
    if (
      !Number.isInteger(input.minutes) ||
      input.minutes < 5 ||
      input.minutes > BREAK_GLASS_MAX_MINUTES
    ) {
      throw new BadRequestException(
        `Duration must be between 5 and ${BREAK_GLASS_MAX_MINUTES} minutes`,
      );
    }
    const role = await this.prisma.role.findUnique({
      where: { id: input.roleId },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.name === 'SUPER_ADMIN')
      throw new ForbiddenException(
        'The Super Admin role cannot be granted through break-glass',
      );
    const held = await this.prisma.identityRole.findUnique({
      where: {
        identityId_roleId: { identityId: actor.identityId, roleId: role.id },
      },
    });
    if (held) throw new ConflictException('You already hold this role');

    const grant = await this.prisma.breakGlassGrant.create({
      data: {
        companyId: actor.companyId,
        identityId: actor.identityId,
        roleId: role.id,
        roleName: role.name,
        reason: input.reason.trim(),
        durationMinutes: input.minutes,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: actor.companyId,
      action: 'security.break_glass_requested',
      entityType: 'BreakGlassGrant',
      entityId: grant.id,
      reason: grant.reason,
      metadata: { role: role.name, minutes: input.minutes },
    });
    return grant;
  }

  async approve(grantId: string, approver: { identityId: string }) {
    const grant = await this.prisma.breakGlassGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) throw new NotFoundException('Request not found');
    if (grant.identityId === approver.identityId) {
      throw new ForbiddenException(
        'You cannot approve your own emergency access',
      );
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + grant.durationMinutes * 60_000);

    await this.prisma.$transaction(async (tx) => {
      // Atomic REQUESTED -> ACTIVE: two approvers cannot both grant it.
      const claim = await tx.breakGlassGrant.updateMany({
        where: { id: grantId, status: 'REQUESTED' },
        data: {
          status: 'ACTIVE',
          approvedByIdentityId: approver.identityId,
          approvedAt: now,
          expiresAt,
        },
      });
      if (claim.count === 0)
        throw new ConflictException('This request has already been decided');
      await tx.identityRole.create({
        data: {
          identityId: grant.identityId,
          roleId: grant.roleId,
          companyId: grant.companyId,
        },
      });
    });
    await this.audit.record({
      identityId: approver.identityId,
      companyId: grant.companyId,
      action: 'security.break_glass_activated',
      entityType: 'BreakGlassGrant',
      entityId: grantId,
      reason: grant.reason,
      metadata: {
        grantedTo: grant.identityId,
        role: grant.roleName,
        expiresAt,
      },
    });
    return this.prisma.breakGlassGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
  }

  async deny(grantId: string, approver: { identityId: string }) {
    const claim = await this.prisma.breakGlassGrant.updateMany({
      where: { id: grantId, status: 'REQUESTED' },
      data: {
        status: 'DENIED',
        approvedByIdentityId: approver.identityId,
        approvedAt: new Date(),
        endedAt: new Date(),
      },
    });
    if (claim.count === 0)
      throw new ConflictException('This request has already been decided');
    await this.audit.record({
      identityId: approver.identityId,
      action: 'security.break_glass_denied',
      entityType: 'BreakGlassGrant',
      entityId: grantId,
    });
    return this.prisma.breakGlassGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
  }

  /**
   * Ends a grant now: the holder giving access back (or withdrawing a request that has not been decided), or a
   * Super Admin. Anyone else is told the grant does not exist, so one company cannot probe or cancel another's.
   */
  async revoke(
    grantId: string,
    actor: { identityId: string; isSuperAdmin?: boolean },
  ) {
    const grant = await this.prisma.breakGlassGrant.findUnique({
      where: { id: grantId },
    });
    if (
      !grant ||
      (grant.identityId !== actor.identityId && !actor.isSuperAdmin)
    ) {
      throw new NotFoundException('Grant not found');
    }
    if (grant.status === 'REQUESTED') {
      const withdrawn = await this.prisma.breakGlassGrant.updateMany({
        where: { id: grantId, status: 'REQUESTED' },
        data: { status: 'REVOKED', endedAt: new Date() },
      });
      if (withdrawn.count === 0)
        throw new ConflictException('This request has already been decided');
      await this.audit.record({
        identityId: actor.identityId,
        companyId: grant.companyId,
        action: 'security.break_glass_withdrawn',
        entityType: 'BreakGlassGrant',
        entityId: grantId,
      });
      return this.prisma.breakGlassGrant.findUniqueOrThrow({
        where: { id: grantId },
      });
    }
    if (grant.status !== 'ACTIVE')
      throw new ConflictException('This grant is not active');
    await this.end(grant.id, 'REVOKED', actor.identityId);
    return this.prisma.breakGlassGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
  }

  private async end(
    grantId: string,
    status: 'EXPIRED' | 'REVOKED',
    actorIdentityId?: string,
  ) {
    const grant = await this.prisma.breakGlassGrant.findUniqueOrThrow({
      where: { id: grantId },
    });
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.breakGlassGrant.updateMany({
        where: { id: grantId, status: 'ACTIVE' },
        data: { status, endedAt: new Date() },
      });
      if (claim.count === 0) return; // someone else ended it
      await tx.identityRole.deleteMany({
        where: { identityId: grant.identityId, roleId: grant.roleId },
      });
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId: grant.companyId,
      action: `security.break_glass_${status.toLowerCase()}`,
      entityType: 'BreakGlassGrant',
      entityId: grantId,
      metadata: { holder: grant.identityId, role: grant.roleName },
    });
  }

  /** Removes every grant whose time is up. Runs each minute; also callable directly. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireDue(now: Date = new Date()): Promise<number> {
    if (process.env.BREAK_GLASS_SWEEP_DISABLED === 'true') return 0;
    const due = await this.prisma.breakGlassGrant.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true },
    });
    for (const g of due) {
      try {
        await this.end(g.id, 'EXPIRED');
      } catch (error) {
        this.logger.error(
          `Could not expire break-glass grant ${g.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return due.length;
  }

  list(tenant?: string) {
    return this.prisma.breakGlassGrant.findMany({
      where: tenant === undefined ? {} : { companyId: tenant },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
  }
}
