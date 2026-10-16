import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma, StaffIdCard, StaffIdCardStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  IssueCardDto,
  ListCardsQueryDto,
  RenewCardDto,
  ReplaceCardDto,
  ScanHistoryQueryDto,
} from './dto/staff-cards.dto';
import {
  STAFF_PHOTO_NAMESPACE,
  normaliseCardImage,
  removeCardImage,
} from './staff-card-images';
import { StaffCardSettingsService } from './staff-card-settings.service';
import {
  addMonths,
  canApply,
  CardAction,
  daysBetween,
  effectiveStatus,
  LIVE_STATUSES,
  newCardNumber,
  newVerificationToken,
  REASON_REQUIRED,
} from './staff-card.policy';

/** Who is doing it. `staffId` lets the service refuse an administrator changing their own card. */
export interface CardActor {
  identityId: string;
  staffId: string | null;
}

const STAFF_SUMMARY = {
  select: {
    id: true,
    employeeCode: true,
    firstName: true,
    lastName: true,
    jobTitle: true,
    department: true,
    isActive: true,
    photoFilename: true,
    branch: { select: { id: true, name: true } },
  },
} as const;

type CardWithStaff = Prisma.StaffIdCardGetPayload<{
  include: { staff: typeof STAFF_SUMMARY };
}>;

export interface CardView {
  id: string;
  cardNumber: string;
  status: StaffIdCardStatus;
  effectiveStatus: StaffIdCardStatus;
  issuedAt: Date | null;
  expiresAt: Date | null;
  activatedAt: Date | null;
  suspendedAt: Date | null;
  revokedAt: Date | null;
  replacedAt: Date | null;
  statusReason: string | null;
  replacedByCardId: string | null;
  printedCount: number;
  lastPrintedAt: Date | null;
  daysToExpiry: number | null;
  createdAt: Date;
  staff: {
    id: string;
    employeeCode: string;
    fullName: string;
    jobTitle: string | null;
    department: string | null;
    branchId: string | null;
    branchName: string | null;
    isActive: boolean;
    hasPhoto: boolean;
  };
}

const VERBS: Record<CardAction, string> = {
  ACTIVATE: 'activated',
  RENEW: 'renewed',
  SUSPEND: 'suspended',
  REINSTATE: 'reinstated',
  REVOKE: 'revoked',
  REPLACE: 'replaced',
};

const isUnique = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: string }).code === 'P2002';

@Injectable()
export class StaffCardsService {
  private readonly logger = new Logger(StaffCardsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: StaffCardSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------------------------------------ views

  toView(card: CardWithStaff, now = new Date()): CardView {
    const eff = effectiveStatus(card, card.staff.isActive, now);
    return {
      id: card.id,
      cardNumber: card.cardNumber,
      status: card.status,
      effectiveStatus: eff,
      issuedAt: card.issuedAt,
      expiresAt: card.expiresAt,
      activatedAt: card.activatedAt,
      suspendedAt: card.suspendedAt,
      revokedAt: card.revokedAt,
      replacedAt: card.replacedAt,
      statusReason: card.statusReason,
      replacedByCardId: card.replacedByCardId,
      printedCount: card.printedCount,
      lastPrintedAt: card.lastPrintedAt,
      daysToExpiry: card.expiresAt ? daysBetween(now, card.expiresAt) : null,
      createdAt: card.createdAt,
      staff: {
        id: card.staff.id,
        employeeCode: card.staff.employeeCode,
        fullName: `${card.staff.firstName} ${card.staff.lastName}`,
        jobTitle: card.staff.jobTitle,
        department: card.staff.department,
        branchId: card.staff.branch?.id ?? null,
        branchName: card.staff.branch?.name ?? null,
        isActive: card.staff.isActive,
        hasPhoto: !!card.staff.photoFilename,
      },
    };
  }

  /** Loads a card of the caller's company. A card of another company is "not found", never "forbidden". */
  async load(id: string, tenant?: string): Promise<CardWithStaff> {
    const card = await this.prisma.staffIdCard.findFirst({
      where: { id, ...(tenant !== undefined && { companyId: tenant }) },
      include: { staff: STAFF_SUMMARY },
    });
    if (!card) throw new NotFoundException('Identification card not found');
    return card;
  }

  async get(id: string, tenant?: string) {
    const card = await this.load(id, tenant);
    const events = await this.prisma.staffIdCardEvent.findMany({
      where: { cardId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { ...this.toView(card), history: events };
  }

  async history(id: string, tenant?: string) {
    await this.load(id, tenant);
    return this.prisma.staffIdCardEvent.findMany({
      where: { cardId: id },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  // ------------------------------------------------------------------------------------------------ issue

  async issue(dto: IssueCardDto, actor: CardActor, tenant?: string) {
    const staff = await this.prisma.staff.findFirst({
      where: {
        id: dto.staffId,
        ...(tenant !== undefined && { companyId: tenant }),
      },
      select: { id: true, companyId: true, isActive: true, employeeCode: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    if (!staff.isActive)
      throw new ConflictException(
        'This staff member is deactivated and cannot be issued a card.',
      );
    if (actor.staffId && actor.staffId === staff.id)
      throw new ForbiddenException(
        'You cannot issue an identification card to yourself. Ask another administrator.',
      );

    const settings = await this.settings.get(staff.companyId);
    const months = dto.validityMonths ?? settings.validityMonths;
    const now = new Date();

    const card = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent issues for the same person, so two clicks cannot create two live cards.
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staff.id} FOR UPDATE`;
      const live = await tx.staffIdCard.findFirst({
        where: { staffId: staff.id, status: { in: [...LIVE_STATUSES] } },
        select: { cardNumber: true, status: true },
      });
      if (live)
        throw new ConflictException(
          `This staff member already has a ${live.status.toLowerCase()} card (${live.cardNumber}). Renew or replace it instead.`,
        );
      const created = await this.createCard(tx, {
        companyId: staff.companyId,
        staffId: staff.id,
        status: dto.activateNow ? 'ACTIVE' : 'PENDING',
        issuedAt: now,
        activatedAt: dto.activateNow ? now : null,
        expiresAt: addMonths(now, months),
        actor,
      });
      await tx.staffIdCardEvent.create({
        data: {
          cardId: created.id,
          action: 'ISSUED',
          toStatus: created.status,
          actorIdentityId: actor.identityId,
          metadata: { validityMonths: months },
        },
      });
      if (dto.activateNow)
        await tx.staffIdCardEvent.create({
          data: {
            cardId: created.id,
            action: 'ACTIVATED',
            fromStatus: 'PENDING',
            toStatus: 'ACTIVE',
            actorIdentityId: actor.identityId,
            // Recorded in the same instant as the issue; a millisecond later so the history reads in order.
            createdAt: new Date(now.getTime() + 1),
          },
        });
      return created;
    });

    await this.audit.record({
      identityId: actor.identityId,
      companyId: staff.companyId,
      action: 'staff_card.issued',
      entityType: 'StaffIdCard',
      entityId: card.id,
      metadata: { cardNumber: card.cardNumber, staffId: staff.id },
    });
    return this.get(card.id, tenant);
  }

  /** Inserts a card with fresh identifiers; the database's uniqueness decides, a collision just draws again. */
  private async createCard(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      staffId: string;
      status: StaffIdCardStatus;
      issuedAt: Date;
      activatedAt: Date | null;
      expiresAt: Date;
      actor: CardActor;
    },
  ): Promise<StaffIdCard> {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        // A savepoint, because a unique violation aborts the surrounding transaction in PostgreSQL.
        await tx.$executeRaw`SAVEPOINT card_insert`;
        const row = await tx.staffIdCard.create({
          data: {
            companyId: input.companyId,
            staffId: input.staffId,
            cardNumber: newCardNumber(),
            verificationToken: newVerificationToken(),
            status: input.status,
            issuedAt: input.issuedAt,
            activatedAt: input.activatedAt,
            expiresAt: input.expiresAt,
            createdByIdentityId: input.actor.identityId,
          },
        });
        await tx.$executeRaw`RELEASE SAVEPOINT card_insert`;
        return row;
      } catch (e) {
        if (!isUnique(e)) throw e;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT card_insert`;
      }
    }
    throw new ConflictException('Could not allocate a card number. Try again.');
  }

  // ------------------------------------------------------------------------------------------------ transitions

  activate(id: string, actor: CardActor, tenant?: string) {
    return this.transition(id, 'ACTIVATE', actor, tenant, {});
  }

  renew(id: string, dto: RenewCardDto, actor: CardActor, tenant?: string) {
    return this.transition(id, 'RENEW', actor, tenant, {
      reason: dto.reason,
      months: dto.validityMonths,
    });
  }

  suspend(id: string, reason: string, actor: CardActor, tenant?: string) {
    return this.transition(id, 'SUSPEND', actor, tenant, { reason });
  }

  reinstate(id: string, reason: string, actor: CardActor, tenant?: string) {
    return this.transition(id, 'REINSTATE', actor, tenant, { reason });
  }

  revoke(id: string, reason: string, actor: CardActor, tenant?: string) {
    return this.transition(id, 'REVOKE', actor, tenant, { reason });
  }

  private async transition(
    id: string,
    action: Exclude<CardAction, 'REPLACE'>,
    actor: CardActor,
    tenant: string | undefined,
    opts: { reason?: string; months?: number },
  ) {
    const card = await this.load(id, tenant);
    this.guard(card, action, actor, opts.reason);
    if (action === 'ACTIVATE') {
      // A card that has an NFC chip is handed over only once the chip was written and read back correctly.
      const chip = await this.prisma.staffIdCardNfc.findUnique({
        where: { cardId: card.id },
        select: { status: true },
      });
      if (chip && chip.status !== 'VERIFIED')
        throw new BadRequestException(
          `The NFC chip for this card is not confirmed yet (${chip.status.toLowerCase()}). Write the chip and confirm it before activating the card.`,
        );
    }
    const now = new Date();
    const eff = effectiveStatus(card, card.staff.isActive, now);
    const settings = await this.settings.get(card.companyId);

    let data: Prisma.StaffIdCardUpdateManyMutationInput;
    let to: StaffIdCardStatus;
    let metadata: Prisma.InputJsonValue | undefined;

    switch (action) {
      case 'ACTIVATE':
        to = 'ACTIVE';
        data = { status: to, activatedAt: now, statusReason: null };
        break;
      case 'RENEW': {
        const months = opts.months ?? settings.validityMonths;
        // Renewing early extends from the current expiry, so no paid-for days are lost; an expired card restarts today.
        const base =
          eff === 'ACTIVE' && card.expiresAt && card.expiresAt > now
            ? card.expiresAt
            : now;
        const expiresAt = addMonths(base, months);
        to = 'ACTIVE';
        data = { status: to, expiresAt, expiryNoticeSentAt: null };
        metadata = {
          from: card.expiresAt?.toISOString() ?? null,
          to: expiresAt.toISOString(),
          months,
        };
        break;
      }
      case 'SUSPEND':
        to = 'SUSPENDED';
        data = { status: to, suspendedAt: now, statusReason: opts.reason };
        break;
      case 'REINSTATE':
        // A suspended card whose date has since passed comes back as an expired one, to be renewed.
        to = card.expiresAt && card.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
        data = { status: to, suspendedAt: null, statusReason: null };
        break;
      case 'REVOKE':
        to = 'REVOKED';
        data = { status: to, revokedAt: now, statusReason: opts.reason };
        break;
    }

    await this.prisma.$transaction(async (tx) => {
      // The status is part of the condition: if someone else changed the card meanwhile, nothing is written.
      const claimed = await tx.staffIdCard.updateMany({
        where: { id: card.id, status: card.status },
        data,
      });
      if (claimed.count === 0)
        throw new ConflictException(
          'This card was changed by someone else a moment ago. Reload and try again.',
        );
      await tx.staffIdCardEvent.create({
        data: {
          cardId: card.id,
          action:
            action === 'ACTIVATE'
              ? 'ACTIVATED'
              : action === 'RENEW'
                ? 'RENEWED'
                : action === 'SUSPEND'
                  ? 'SUSPENDED'
                  : action === 'REINSTATE'
                    ? 'REINSTATED'
                    : 'REVOKED',
          fromStatus: eff,
          toStatus: to,
          reason: opts.reason,
          actorIdentityId: actor.identityId,
          metadata,
        },
      });
    });

    await this.audit.record({
      identityId: actor.identityId,
      companyId: card.companyId,
      action: `staff_card.${action.toLowerCase()}`,
      entityType: 'StaffIdCard',
      entityId: card.id,
      reason: opts.reason,
      metadata: { cardNumber: card.cardNumber, from: eff, to },
    });
    return this.get(card.id, tenant);
  }

  async replace(
    id: string,
    dto: ReplaceCardDto,
    actor: CardActor,
    tenant?: string,
  ) {
    const old = await this.load(id, tenant);
    this.guard(old, 'REPLACE', actor, dto.reason);
    if (!old.staff.isActive)
      throw new ConflictException(
        'This staff member is deactivated; a replacement card cannot be issued.',
      );
    const now = new Date();
    const eff = effectiveStatus(old, old.staff.isActive, now);
    const settings = await this.settings.get(old.companyId);
    const activate = dto.activateNow ?? old.status === 'ACTIVE';

    const created = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.staffIdCard.updateMany({
        where: { id: old.id, status: old.status },
        data: {
          status: 'REPLACED',
          replacedAt: now,
          statusReason: dto.reason,
        },
      });
      if (claimed.count === 0)
        throw new ConflictException(
          'This card was changed by someone else a moment ago. Reload and try again.',
        );
      const fresh = await this.createCard(tx, {
        companyId: old.companyId,
        staffId: old.staffId,
        status: activate ? 'ACTIVE' : 'PENDING',
        issuedAt: now,
        activatedAt: activate ? now : null,
        expiresAt: addMonths(now, settings.validityMonths),
        actor,
      });
      await tx.staffIdCard.update({
        where: { id: old.id },
        data: { replacedByCardId: fresh.id },
      });
      await tx.staffIdCardEvent.create({
        data: {
          cardId: old.id,
          action: 'REPLACED',
          fromStatus: eff,
          toStatus: 'REPLACED',
          reason: dto.reason,
          actorIdentityId: actor.identityId,
          metadata: { replacedBy: fresh.cardNumber },
        },
      });
      await tx.staffIdCardEvent.create({
        data: {
          cardId: fresh.id,
          action: 'ISSUED',
          toStatus: fresh.status,
          reason: dto.reason,
          actorIdentityId: actor.identityId,
          metadata: { replaces: old.cardNumber },
        },
      });
      return fresh;
    });

    await this.audit.record({
      identityId: actor.identityId,
      companyId: old.companyId,
      action: 'staff_card.replaced',
      entityType: 'StaffIdCard',
      entityId: old.id,
      reason: dto.reason,
      metadata: { old: old.cardNumber, new: created.cardNumber },
    });
    return this.get(created.id, tenant);
  }

  /** The checks every state change shares. */
  private guard(
    card: CardWithStaff,
    action: CardAction,
    actor: CardActor,
    reason?: string,
  ): void {
    if (actor.staffId && actor.staffId === card.staffId)
      throw new ForbiddenException(
        'You cannot change your own identification card. Ask another administrator.',
      );
    const eff = effectiveStatus(card, card.staff.isActive);
    if (!canApply(action, eff))
      throw new ConflictException(
        `A ${eff.toLowerCase()} card cannot be ${VERBS[action]}.`,
      );
    if (!card.staff.isActive && action !== 'REVOKE' && action !== 'REPLACE')
      throw new ConflictException(
        'This staff member is deactivated; their card cannot be changed.',
      );
    if (REASON_REQUIRED.includes(action) && !reason?.trim())
      throw new BadRequestException('A reason is required for this action.');
  }

  /** When a staff member leaves, every card they still hold stops working; the history stays. */
  @OnEvent('staff.deactivated')
  async onStaffDeactivated(payload: {
    staffId: string;
    actorIdentityId?: string;
  }): Promise<void> {
    try {
      await this.deactivateForStaff(payload.staffId, payload.actorIdentityId);
    } catch (e) {
      this.logger.error(
        `Could not revoke cards of deactivated staff ${payload.staffId}: ${(e as Error).message}`,
      );
    }
  }

  async deactivateForStaff(
    staffId: string,
    actorIdentityId?: string,
  ): Promise<number> {
    const cards = await this.prisma.staffIdCard.findMany({
      where: { staffId, status: { in: [...LIVE_STATUSES] } },
      select: { id: true, companyId: true, status: true, cardNumber: true },
    });
    const now = new Date();
    for (const c of cards) {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.staffIdCard.updateMany({
          where: { id: c.id, status: c.status },
          data: {
            status: 'REVOKED',
            revokedAt: now,
            statusReason: 'Staff member deactivated',
          },
        });
        if (claimed.count === 0) return;
        await tx.staffIdCardEvent.create({
          data: {
            cardId: c.id,
            action: 'STAFF_DEACTIVATED',
            fromStatus: c.status,
            toStatus: 'REVOKED',
            reason: 'Staff member deactivated',
            actorIdentityId,
          },
        });
      });
      await this.audit.record({
        identityId: actorIdentityId,
        companyId: c.companyId,
        action: 'staff_card.revoked_staff_deactivated',
        entityType: 'StaffIdCard',
        entityId: c.id,
        metadata: { cardNumber: c.cardNumber },
      });
    }
    return cards.length;
  }

  // ------------------------------------------------------------------------------------------------ photo

  /** Stores the staff member's photograph (re-encoded, metadata stripped). Their own photo needs a second person. */
  async setPhoto(
    staffId: string,
    file: Express.Multer.File,
    actor: CardActor,
    tenant?: string,
  ) {
    const staff = await this.prisma.staff.findFirst({
      where: {
        id: staffId,
        ...(tenant !== undefined && { companyId: tenant }),
      },
      select: { id: true, companyId: true, photoFilename: true },
    });
    if (!staff) {
      await removeCardImage(STAFF_PHOTO_NAMESPACE, file.filename);
      throw new NotFoundException('Staff member not found');
    }
    const stored = await normaliseCardImage(
      file,
      STAFF_PHOTO_NAMESPACE,
      'photo',
    );
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { photoFilename: stored },
    });
    await removeCardImage(STAFF_PHOTO_NAMESPACE, staff.photoFilename);
    await this.audit.record({
      identityId: actor.identityId,
      companyId: staff.companyId,
      action: 'staff_card.photo_changed',
      entityType: 'Staff',
      entityId: staff.id,
    });
    return { hasPhoto: true };
  }

  // ------------------------------------------------------------------------------------------------ lists

  private whereFor(
    q: ListCardsQueryDto,
    tenant: string | undefined,
    now: Date,
  ) {
    const and: Prisma.StaffIdCardWhereInput[] = [];
    if (q.status === 'ACTIVE')
      and.push({
        status: 'ACTIVE',
        staff: { isActive: true },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      });
    else if (q.status === 'EXPIRED')
      and.push({
        OR: [
          { status: 'EXPIRED' },
          { status: 'ACTIVE', expiresAt: { lte: now } },
        ],
      });
    else if (q.status) and.push({ status: q.status as StaffIdCardStatus });
    if (q.expiringWithinDays)
      and.push({
        status: 'ACTIVE',
        expiresAt: {
          gt: now,
          lte: new Date(now.getTime() + q.expiringWithinDays * 86_400_000),
        },
      });
    if (q.branchId) and.push({ staff: { branchId: q.branchId } });
    if (q.department)
      and.push({
        staff: { department: { equals: q.department, mode: 'insensitive' } },
      });
    if (q.search)
      and.push({
        OR: [
          { cardNumber: { contains: q.search, mode: 'insensitive' } },
          {
            staff: {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { employeeCode: { contains: q.search, mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
    return {
      ...(tenant !== undefined && { companyId: tenant }),
      ...(and.length && { AND: and }),
    } satisfies Prisma.StaffIdCardWhereInput;
  }

  async list(q: ListCardsQueryDto, tenant?: string) {
    const now = new Date();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where = this.whereFor(q, tenant, now);
    const [total, rows] = await Promise.all([
      this.prisma.staffIdCard.count({ where }),
      this.prisma.staffIdCard.findMany({
        where,
        include: { staff: STAFF_SUMMARY },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => this.toView(r, now)),
      total,
      page,
      pageSize,
    };
  }

  /** Active staff who hold no current card yet: who can still be issued one. */
  async staffWithoutCard(tenant?: string, search?: string) {
    return this.prisma.staff.findMany({
      where: {
        isActive: true,
        ...(tenant !== undefined && { companyId: tenant }),
        idCards: { none: { status: { in: [...LIVE_STATUSES] } } },
        ...(search && {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { employeeCode: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        department: true,
        photoFilename: true,
        branch: { select: { name: true } },
      },
      orderBy: { lastName: 'asc' },
      take: 100,
    });
  }

  async dashboard(tenant?: string) {
    const now = new Date();
    const scope: Prisma.StaffIdCardWhereInput =
      tenant !== undefined ? { companyId: tenant } : {};
    const settings = tenant ? await this.settings.get(tenant) : null;
    const warnDays = settings?.expiryWarningDays ?? 30;
    const soon = new Date(now.getTime() + warnDays * 86_400_000);
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

    const count = (extra: Prisma.StaffIdCardWhereInput) =>
      this.prisma.staffIdCard.count({ where: { ...scope, ...extra } });

    const [
      total,
      pending,
      active,
      expiringSoon,
      expired,
      suspended,
      revoked,
      replaced,
      recent,
      scans,
    ] = await Promise.all([
      count({}),
      count({ status: 'PENDING' }),
      count({
        status: 'ACTIVE',
        staff: { isActive: true },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      }),
      count({ status: 'ACTIVE', expiresAt: { gt: now, lte: soon } }),
      count({
        OR: [
          { status: 'EXPIRED' },
          { status: 'ACTIVE', expiresAt: { lte: now } },
        ],
      }),
      count({ status: 'SUSPENDED' }),
      count({ status: 'REVOKED' }),
      count({ status: 'REPLACED' }),
      this.prisma.staffIdCard.findMany({
        where: { ...scope, createdAt: { gte: monthAgo } },
        include: { staff: STAFF_SUMMARY },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.staffIdCardScan.groupBy({
        by: ['result'],
        where: {
          ...(tenant !== undefined && { companyId: tenant }),
          createdAt: { gte: dayAgo },
        },
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      pending,
      active,
      expiringSoon,
      expiringSoonWindowDays: warnDays,
      expired,
      suspended,
      revoked,
      replaced,
      recentlyIssued: recent.map((r) => this.toView(r, now)),
      scansLast24h: Object.fromEntries(
        scans.map((s) => [s.result, s._count._all]),
      ),
    };
  }

  async scanHistory(q: ScanHistoryQueryDto, tenant?: string) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const where: Prisma.StaffIdCardScanWhereInput = {
      ...(tenant !== undefined && { companyId: tenant }),
      ...(q.result && { result: q.result }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.staffIdCardScan.count({ where }),
      this.prisma.staffIdCardScan.findMany({
        where,
        include: {
          card: {
            select: {
              cardNumber: true,
              staff: {
                select: { firstName: true, lastName: true, employeeCode: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        id: r.id,
        result: r.result,
        method: r.method,
        createdAt: r.createdAt,
        scannedByIdentityId: r.scannedByIdentityId,
        cardNumber: r.card?.cardNumber ?? null,
        staffName: r.card
          ? `${r.card.staff.firstName} ${r.card.staff.lastName}`
          : null,
        staffId: r.card?.staff.employeeCode ?? null,
        presented: r.queryHint,
      })),
    };
  }

  // ------------------------------------------------------------------------------------------------ maintenance

  /**
   * Records expiries that have happened and warns the company's administrators about the ones coming up.
   * Idempotent: running it twice does the same as running it once.
   */
  async sweep(now = new Date()): Promise<{ expired: number; warned: number }> {
    const due = await this.prisma.staffIdCard.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true },
      take: 1000,
    });
    let expired = 0;
    for (const { id } of due) {
      const claimed = await this.prisma.staffIdCard.updateMany({
        where: { id, status: 'ACTIVE', expiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      if (claimed.count) {
        expired++;
        await this.prisma.staffIdCardEvent.create({
          data: {
            cardId: id,
            action: 'EXPIRED',
            fromStatus: 'ACTIVE',
            toStatus: 'EXPIRED',
            reason: 'Expiry date reached',
          },
        });
      }
    }

    let warned = 0;
    const companies = await this.prisma.staffCardSettings.findMany({
      select: { companyId: true, expiryWarningDays: true },
    });
    for (const c of companies) {
      const soon = await this.prisma.staffIdCard.findMany({
        where: {
          companyId: c.companyId,
          status: 'ACTIVE',
          expiryNoticeSentAt: null,
          expiresAt: {
            gt: now,
            lte: new Date(now.getTime() + c.expiryWarningDays * 86_400_000),
          },
        },
        include: { staff: STAFF_SUMMARY },
        take: 500,
      });
      if (!soon.length) continue;
      const admins = await this.prisma.identity.findMany({
        where: {
          status: 'ACTIVE',
          staff: { is: { companyId: c.companyId } },
          roles: { some: { role: { name: 'COMPANY_ADMIN' } } },
        },
        select: { id: true, email: true },
      });
      for (const card of soon) {
        const when = card.expiresAt!.toISOString().slice(0, 10);
        for (const admin of admins) {
          await this.notifications.sendWorkflowMessage({
            channel: 'EMAIL',
            to: admin.email,
            identityId: admin.id,
            subject: `Identification card expiring: ${card.staff.firstName} ${card.staff.lastName}`,
            body: `The identification card ${card.cardNumber} of ${card.staff.firstName} ${card.staff.lastName} (${card.staff.employeeCode}) expires on ${when}. Renew it under Staff Management → Identification Cards.`,
            idempotencyKey: `card-expiry:${card.id}:${admin.id}`,
          });
        }
        await this.prisma.staffIdCard.update({
          where: { id: card.id },
          data: { expiryNoticeSentAt: now },
        });
        warned++;
      }
    }
    return { expired, warned };
  }

  /** Counts a print, for the history. */
  async recordPrint(
    ids: string[],
    actor: CardActor,
    tenant?: string,
  ): Promise<void> {
    const cards = await this.prisma.staffIdCard.findMany({
      where: {
        id: { in: ids },
        ...(tenant !== undefined && { companyId: tenant }),
      },
      select: { id: true, companyId: true, cardNumber: true },
    });
    const now = new Date();
    for (const c of cards) {
      await this.prisma.staffIdCard.update({
        where: { id: c.id },
        data: { printedCount: { increment: 1 }, lastPrintedAt: now },
      });
      await this.prisma.staffIdCardEvent.create({
        data: {
          cardId: c.id,
          action: 'PRINTED',
          actorIdentityId: actor.identityId,
        },
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId: c.companyId,
        action: 'staff_card.printed',
        entityType: 'StaffIdCard',
        entityId: c.id,
        metadata: { cardNumber: c.cardNumber },
      });
    }
  }
}
