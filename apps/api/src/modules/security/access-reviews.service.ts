import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessReviewDecision } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Periodic user access review. Starting one snapshots every staff account of the company with its roles and
 * last sign-in; a reviewer marks each KEEP or REVOKE; completing the review (only when nothing is left
 * PENDING) actually deactivates the REVOKEd accounts and ends their sessions. The reviewer cannot decide
 * on their own account.
 */
@Injectable()
export class AccessReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async start(actor: { identityId: string; companyId: string | null }) {
    if (!actor.companyId)
      throw new BadRequestException(
        'Your account is not attached to a company',
      );
    const open = await this.prisma.accessReview.findFirst({
      where: { companyId: actor.companyId, status: 'OPEN' },
      select: { id: true },
    });
    if (open)
      throw new ConflictException(
        'A review is already in progress; finish it first',
      );

    const staff = await this.prisma.staff.findMany({
      where: { companyId: actor.companyId, isActive: true },
      select: {
        firstName: true,
        lastName: true,
        identity: {
          select: {
            id: true,
            email: true,
            status: true,
            lastLoginAt: true,
            twoFactorEnabled: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        },
      },
    });

    const review = await this.prisma.accessReview.create({
      data: {
        companyId: actor.companyId,
        startedByIdentityId: actor.identityId,
        items: {
          create: staff.map((s) => ({
            identityId: s.identity.id,
            email: s.identity.email,
            staffName: `${s.firstName} ${s.lastName}`,
            roles: s.identity.roles.map((r) => r.role.name),
            lastLoginAt: s.identity.lastLoginAt,
            twoFactorEnabled: s.identity.twoFactorEnabled,
            isActive: s.identity.status === 'ACTIVE',
          })),
        },
      },
      include: { items: true },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId: actor.companyId,
      action: 'security.access_review_started',
      entityType: 'AccessReview',
      entityId: review.id,
      metadata: { accounts: review.items.length },
    });
    return review;
  }

  list(tenant?: string) {
    return this.prisma.accessReview.findMany({
      where: tenant === undefined ? {} : { companyId: tenant },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: { _count: { select: { items: true } } },
    });
  }

  async get(id: string, tenant?: string) {
    const review = await this.prisma.accessReview.findFirst({
      where: { id, ...(tenant !== undefined && { companyId: tenant }) },
      include: { items: { orderBy: { staffName: 'asc' } } },
    });
    if (!review) throw new NotFoundException('Access review not found');
    return review;
  }

  async decide(
    reviewId: string,
    itemId: string,
    decision: AccessReviewDecision,
    note: string | undefined,
    actor: { identityId: string },
    tenant?: string,
  ) {
    const review = await this.get(reviewId, tenant);
    if (review.status !== 'OPEN')
      throw new ConflictException('This review is already completed');
    const item = review.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('Review item not found');
    if (item.identityId === actor.identityId) {
      throw new ForbiddenException(
        'You cannot decide on your own access; ask another administrator',
      );
    }
    if (decision === 'PENDING')
      throw new BadRequestException('Choose KEEP or REVOKE');
    return this.prisma.accessReviewItem.update({
      where: { id: itemId },
      data: {
        decision,
        note,
        decidedByIdentityId: actor.identityId,
        decidedAt: new Date(),
      },
    });
  }

  /** Completes the review: refuses while anything is undecided, then applies the revocations. */
  async complete(
    reviewId: string,
    actor: { identityId: string },
    tenant?: string,
  ) {
    const review = await this.get(reviewId, tenant);
    if (review.status !== 'OPEN')
      throw new ConflictException('This review is already completed');
    const pending = review.items.filter((i) => i.decision === 'PENDING').length;
    if (pending > 0)
      throw new ConflictException(
        `${pending} account(s) have not been decided yet`,
      );

    const claim = await this.prisma.accessReview.updateMany({
      where: { id: reviewId, status: 'OPEN' },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedByIdentityId: actor.identityId,
      },
    });
    if (claim.count === 0)
      throw new ConflictException('This review was completed by someone else');

    const revoke = review.items.filter((i) => i.decision === 'REVOKE');
    for (const item of revoke) {
      if (item.identityId === actor.identityId) continue; // never lock the reviewer out of their own review
      await this.prisma.identity.update({
        where: { id: item.identityId },
        data: { status: 'DEACTIVATED' },
      });
      await this.prisma.refreshToken.updateMany({
        where: { identityId: item.identityId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.accessReviewItem.update({
        where: { id: item.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId: review.companyId,
        action: 'security.access_revoked',
        entityType: 'Identity',
        entityId: item.identityId,
        metadata: { reviewId, email: item.email, roles: item.roles },
      });
    }
    await this.audit.record({
      identityId: actor.identityId,
      companyId: review.companyId,
      action: 'security.access_review_completed',
      entityType: 'AccessReview',
      entityId: reviewId,
      metadata: {
        kept: review.items.length - revoke.length,
        revoked: revoke.length,
      },
    });
    return this.get(reviewId, tenant);
  }
}
