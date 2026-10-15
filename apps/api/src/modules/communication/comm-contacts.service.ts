import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CommChannel,
  CommContactKind,
  CommSubscriptionStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { csvRowsToRecords, parseCsv, toCsv } from '../data/csv.util';
import { CommConsentService } from './comm-consent.service';
import {
  CONTACT_INTERESTS,
  newOpaqueToken,
  normaliseEmail,
  normalisePhone,
  normaliseTags,
} from './comm-identifiers';
import {
  CreateContactDto,
  ListContactsQueryDto,
  UpdateContactDto,
} from './dto/comm.dto';

export const IMPORT_ROW_LIMIT = 5000;
export const EXPORT_ROW_LIMIT = 10000;

const CONTACT_SELECT = {
  id: true,
  fullName: true,
  primaryPhone: true,
  primaryEmail: true,
  preferredLanguage: true,
  country: true,
  source: true,
  kind: true,
  status: true,
  tags: true,
  interests: true,
  lastCommunicatedAt: true,
  customerId: true,
  leadId: true,
  staffId: true,
  createdAt: true,
  subscriptions: {
    select: {
      channel: true,
      status: true,
      topics: true,
      subscribedAt: true,
      unsubscribedAt: true,
    },
  },
} satisfies Prisma.CommContactSelect;

export interface Actor {
  identityId: string;
}

export interface ImportRowResult {
  row: number;
  outcome: 'CREATED' | 'DUPLICATE' | 'INVALID' | 'CONFLICT';
  message?: string;
}

const KIND_ALIASES: Record<string, CommContactKind> = {
  customer: 'CUSTOMER',
  client: 'CUSTOMER',
  staff: 'STAFF',
  lead: 'LEAD',
  prospect: 'LEAD',
  subscriber: 'SUBSCRIBER',
  other: 'OTHER',
};
const LANGUAGE_ALIASES: Record<string, string> = {
  en: 'en',
  english: 'en',
  ha: 'ha',
  hausa: 'ha',
  ar: 'ar',
  arabic: 'ar',
};

@Injectable()
export class CommContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly consent: CommConsentService,
  ) {}

  /** Real counts for the overview page: nothing estimated, nothing cached. */
  async overview(companyId: string) {
    const [contacts, bySub, suppressions, recent, bySource] = await Promise.all(
      [
        this.prisma.commContact.count({
          where: { companyId, status: 'ACTIVE' },
        }),
        this.prisma.commSubscription.groupBy({
          by: ['channel', 'status'],
          where: { companyId, contact: { status: 'ACTIVE' } },
          _count: { _all: true },
        }),
        this.prisma.commSuppression.groupBy({
          by: ['channel', 'reason'],
          where: { companyId, liftedAt: null },
          _count: { _all: true },
        }),
        this.prisma.commConsentRecord.findMany({
          where: { companyId },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true,
            channel: true,
            action: true,
            source: true,
            createdAt: true,
            contact: { select: { id: true, fullName: true } },
          },
        }),
        this.prisma.commContact.groupBy({
          by: ['kind'],
          where: { companyId, status: 'ACTIVE' },
          _count: { _all: true },
        }),
      ],
    );
    const sub = (channel: CommChannel, status: CommSubscriptionStatus) =>
      bySub.find((r) => r.channel === channel && r.status === status)?._count
        ._all ?? 0;
    const channelBlock = (channel: CommChannel) => ({
      subscribed: sub(channel, 'SUBSCRIBED'),
      pending: sub(channel, 'PENDING_CONFIRMATION'),
      unsubscribed: sub(channel, 'UNSUBSCRIBED'),
      suppressed: suppressions
        .filter((r) => r.channel === channel)
        .reduce((n, r) => n + r._count._all, 0),
    });
    return {
      contacts,
      byKind: Object.fromEntries(bySource.map((r) => [r.kind, r._count._all])),
      whatsapp: channelBlock('WHATSAPP'),
      email: channelBlock('EMAIL'),
      recentConsent: recent,
    };
  }

  // ---------------------------------------------------------------------------------------------- reads

  async list(companyId: string | undefined, q: ListContactsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const and: Prisma.CommContactWhereInput[] = [];
    if (companyId) and.push({ companyId });
    and.push({
      status: (q.status as 'ACTIVE' | 'MERGED' | 'ERASED') ?? 'ACTIVE',
    });
    if (q.kind) and.push({ kind: q.kind });
    if (q.language) and.push({ preferredLanguage: q.language });
    if (q.tag) and.push({ tags: { has: q.tag.toLowerCase() } });
    if (q.interest) and.push({ interests: { has: q.interest } });
    if (q.search) {
      const s = q.search.trim();
      const phone = normalisePhone(s);
      and.push({
        OR: [
          { fullName: { contains: s, mode: 'insensitive' } },
          { primaryEmail: { contains: s.toLowerCase() } },
          // Only something that looks like a phone number is matched against phones; a name or email that merely
          // contains a digit must not match every number containing that digit.
          ...(/^[+\d\s()-]{4,}$/.test(s)
            ? [{ primaryPhone: { contains: s.replace(/[^\d+]/g, '') } }]
            : []),
          ...(phone ? [{ channels: { some: { value: phone } } }] : []),
        ],
      });
    }
    if (q.subscribedTo || q.subscription) {
      and.push({
        subscriptions: {
          some: {
            ...(q.subscribedTo ? { channel: q.subscribedTo } : {}),
            status: (q.subscription as CommSubscriptionStatus) ?? 'SUBSCRIBED',
          },
        },
      });
    }
    const where: Prisma.CommContactWhereInput = { AND: and };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.commContact.count({ where }),
      this.prisma.commContact.findMany({
        where,
        select: CONTACT_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(companyId: string | undefined, id: string) {
    const contact = await this.prisma.commContact.findFirst({
      where: { id, ...(companyId ? { companyId } : {}) },
      select: {
        ...CONTACT_SELECT,
        channels: {
          select: {
            id: true,
            type: true,
            value: true,
            isPrimary: true,
            invalid: true,
          },
        },
        mergedIntoId: true,
        companyId: true,
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  /** The unguessable value used in this contact's unsubscribe and preference links. */
  async preferenceTokenFor(companyId: string, id: string): Promise<string> {
    const c = await this.prisma.commContact.findFirst({
      where: { id, companyId },
      select: { preferenceToken: true },
    });
    if (!c) throw new NotFoundException('Contact not found');
    return c.preferenceToken;
  }

  // ---------------------------------------------------------------------------------------------- create / update

  private cleanInterests(interests?: string[]): string[] {
    return [
      ...new Set(
        (interests ?? []).filter((i) =>
          (CONTACT_INTERESTS as readonly string[]).includes(i),
        ),
      ),
    ];
  }

  /** Existing contacts that already hold this phone or email, in this company. */
  async findByAddresses(
    companyId: string,
    phone: string | null,
    email: string | null,
  ): Promise<{ id: string; fullName: string }[]> {
    const or: Prisma.CommContactChannelWhereInput[] = [];
    if (phone) or.push({ type: 'PHONE', value: phone });
    if (email) or.push({ type: 'EMAIL', value: email });
    if (or.length === 0) return [];
    const rows = await this.prisma.commContactChannel.findMany({
      where: { companyId, OR: or },
      select: {
        contact: { select: { id: true, fullName: true, status: true } },
      },
    });
    const seen = new Map<string, { id: string; fullName: string }>();
    for (const r of rows)
      if (r.contact.status === 'ACTIVE')
        seen.set(r.contact.id, {
          id: r.contact.id,
          fullName: r.contact.fullName,
        });
    return [...seen.values()];
  }

  /**
   * Creates a contact. Having a contact is NOT consent to market: no subscription is created here, whatever the
   * source. An existing contact with the same phone or email is a conflict, not a second record.
   */
  async create(companyId: string, dto: CreateContactDto, actor?: Actor) {
    const phone = dto.phone ? normalisePhone(dto.phone) : null;
    const email = dto.email ? normaliseEmail(dto.email) : null;
    if (dto.phone && !phone)
      throw new BadRequestException('That phone number is not valid.');
    if (dto.email && !email)
      throw new BadRequestException('That email address is not valid.');
    if (!phone && !email)
      throw new BadRequestException('Add a phone number or an email address.');
    const dupes = await this.findByAddresses(companyId, phone, email);
    if (dupes.length)
      throw new ConflictException(
        `A contact with this phone number or email already exists: "${dupes[0].fullName}" (contact ${dupes[0].id}).`,
      );
    return this.insert(companyId, {
      fullName: dto.fullName,
      phone,
      email,
      preferredLanguage: dto.preferredLanguage ?? 'en',
      country: dto.country,
      source: dto.source ?? 'ADMIN_ENTRY',
      kind: dto.kind ?? 'OTHER',
      tags: dto.tags,
      interests: dto.interests,
      actor,
    });
  }

  /** Shared by manual entry, import and the public form. Does not check for duplicates: callers decide how to. */
  async insert(
    companyId: string,
    p: {
      fullName: string;
      phone: string | null;
      email: string | null;
      preferredLanguage?: string;
      country?: string;
      source: string;
      kind: CommContactKind;
      tags?: string[];
      interests?: string[];
      customerId?: string;
      leadId?: string;
      staffId?: string;
      actor?: Actor;
    },
  ) {
    const contact = await this.prisma.commContact.create({
      data: {
        companyId,
        fullName: p.fullName.trim(),
        primaryPhone: p.phone,
        primaryEmail: p.email,
        preferredLanguage: p.preferredLanguage ?? 'en',
        country: p.country?.trim() || null,
        source: p.source,
        kind: p.kind,
        tags: normaliseTags(p.tags),
        interests: this.cleanInterests(p.interests),
        preferenceToken: newOpaqueToken(),
        customerId: p.customerId,
        leadId: p.leadId,
        staffId: p.staffId,
        createdByIdentityId: p.actor?.identityId,
        channels: {
          create: [
            ...(p.phone
              ? [
                  {
                    companyId,
                    type: 'PHONE' as const,
                    value: p.phone,
                    isPrimary: true,
                  },
                ]
              : []),
            ...(p.email
              ? [
                  {
                    companyId,
                    type: 'EMAIL' as const,
                    value: p.email,
                    isPrimary: true,
                  },
                ]
              : []),
          ],
        },
      },
      select: CONTACT_SELECT,
    });
    await this.audit.record({
      identityId: p.actor?.identityId,
      companyId,
      action: 'comm.contact_created',
      entityType: 'CommContact',
      entityId: contact.id,
      metadata: { source: p.source, kind: p.kind },
    });
    return contact;
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateContactDto,
    actor: Actor,
  ) {
    const current = await this.prisma.commContact.findFirst({
      where: { id, companyId, status: 'ACTIVE' },
      include: { channels: true },
    });
    if (!current) throw new NotFoundException('Contact not found');

    const data: Prisma.CommContactUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.preferredLanguage !== undefined)
      data.preferredLanguage = dto.preferredLanguage;
    if (dto.country !== undefined) data.country = dto.country.trim() || null;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.tags !== undefined) data.tags = normaliseTags(dto.tags);
    if (dto.interests !== undefined)
      data.interests = this.cleanInterests(dto.interests);

    const channelOps = await this.channelChanges(companyId, current, dto);
    Object.assign(data, channelOps.contactData);

    await this.prisma.$transaction(async (tx) => {
      for (const del of channelOps.remove)
        await tx.commContactChannel.delete({ where: { id: del } });
      for (const add of channelOps.add)
        await tx.commContactChannel.create({ data: add });
      await tx.commContact.update({ where: { id }, data });
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.contact_updated',
      entityType: 'CommContact',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return this.get(companyId, id);
  }

  /**
   * Changing an address does NOT carry the old address's consent to the new one. Consent was given for a specific
   * number or email; the subscription for that channel is reset to NONE (the withdrawal on the old address, if any,
   * stays in the suppression list).
   */
  private async channelChanges(
    companyId: string,
    current: Prisma.CommContactGetPayload<{ include: { channels: true } }>,
    dto: UpdateContactDto,
  ) {
    const add: Prisma.CommContactChannelUncheckedCreateInput[] = [];
    const remove: string[] = [];
    const contactData: Prisma.CommContactUpdateInput = {};
    const handle = async (
      type: 'PHONE' | 'EMAIL',
      raw: string | undefined,
      normalise: (v: string) => string | null,
      label: string,
    ) => {
      if (raw === undefined) return;
      const existing = current.channels.filter((c) => c.type === type);
      if (raw === '') {
        remove.push(...existing.map((c) => c.id));
        contactData[type === 'PHONE' ? 'primaryPhone' : 'primaryEmail'] = null;
        return;
      }
      const value = normalise(raw);
      if (!value) throw new BadRequestException(`That ${label} is not valid.`);
      if (existing.some((c) => c.value === value)) return;
      const taken = await this.prisma.commContactChannel.findFirst({
        where: { companyId, type, value },
        select: { contactId: true },
      });
      if (taken && taken.contactId !== current.id)
        throw new ConflictException(
          `Another contact already has this ${label} (contact ${taken.contactId}).`,
        );
      remove.push(...existing.map((c) => c.id));
      add.push({
        contactId: current.id,
        companyId,
        type,
        value,
        isPrimary: true,
      });
      contactData[type === 'PHONE' ? 'primaryPhone' : 'primaryEmail'] = value;
    };
    await handle('PHONE', dto.phone, (v) => normalisePhone(v), 'phone number');
    await handle('EMAIL', dto.email, (v) => normaliseEmail(v), 'email address');
    return { add, remove, contactData };
  }

  // ---------------------------------------------------------------------------------------------- duplicates and merge

  /** Groups of active contacts that share an address (same phone or same email), or the same name and language. */
  async findDuplicates(companyId: string) {
    const shared = await this.prisma.$queryRaw<
      { type: string; value: string; ids: string[] }[]
    >(Prisma.sql`
      SELECT 'ADDRESS'::text AS type, ch.value AS value, array_agg(DISTINCT c.id) AS ids
      FROM comm_contact_channels ch
      JOIN comm_contacts c ON c.id = ch."contactId"
      WHERE c."companyId" = ${companyId} AND c.status = 'ACTIVE'
      GROUP BY ch.value
      HAVING COUNT(DISTINCT c.id) > 1
      LIMIT 100`);
    const byName = await this.prisma.$queryRaw<
      { value: string; ids: string[] }[]
    >(Prisma.sql`
      SELECT lower(trim(c."fullName")) AS value, array_agg(c.id) AS ids
      FROM comm_contacts c
      WHERE c."companyId" = ${companyId} AND c.status = 'ACTIVE'
      GROUP BY lower(trim(c."fullName"))
      HAVING COUNT(*) > 1
      LIMIT 100`);
    const groups = [
      ...shared.map((g) => ({ reason: 'SAME_ADDRESS' as const, ids: g.ids })),
      ...byName.map((g) => ({ reason: 'SAME_NAME' as const, ids: g.ids })),
    ];
    const allIds = [...new Set(groups.flatMap((g) => g.ids))];
    const people = await this.prisma.commContact.findMany({
      where: { id: { in: allIds }, companyId },
      select: {
        id: true,
        fullName: true,
        primaryPhone: true,
        primaryEmail: true,
        source: true,
        createdAt: true,
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return groups.map((g) => ({
      reason: g.reason,
      contacts: g.ids.map((i) => byId.get(i)).filter(Boolean),
    }));
  }

  /**
   * Folds duplicates into one surviving contact. Nothing about consent is lost or widened:
   *  - channels, tags, interests, segment membership and consent history move to the survivor;
   *  - per channel the MOST RESTRICTIVE state wins (any unsubscribe keeps the person unsubscribed);
   *  - a merged record is kept (status MERGED) and points at the survivor, so its history is still reachable.
   */
  async merge(
    companyId: string,
    survivorId: string,
    mergeIds: string[],
    actor: Actor,
  ) {
    const ids = [...new Set(mergeIds)].filter((i) => i !== survivorId);
    if (ids.length === 0)
      throw new BadRequestException(
        'Choose at least one other contact to merge.',
      );
    const people = await this.prisma.commContact.findMany({
      where: { companyId, id: { in: [survivorId, ...ids] }, status: 'ACTIVE' },
      include: { channels: true, subscriptions: true },
    });
    if (people.length !== ids.length + 1)
      throw new NotFoundException(
        'One of the contacts was not found or is no longer active.',
      );
    const survivor = people.find((p) => p.id === survivorId)!;
    const others = people.filter((p) => p.id !== survivorId);

    await this.prisma.$transaction(async (tx) => {
      const tags = new Set(survivor.tags);
      const interests = new Set(survivor.interests);
      let phone = survivor.primaryPhone;
      let email = survivor.primaryEmail;
      const links: Prisma.CommContactUpdateInput = {};
      const clearLinks: { id: string; data: Prisma.CommContactUpdateInput }[] =
        [];

      for (const o of others) {
        o.tags.forEach((t) => tags.add(t));
        o.interests.forEach((t) => interests.add(t));
        phone ??= o.primaryPhone;
        email ??= o.primaryEmail;
        // The unique links must be released on the merged record before the survivor can take them.
        const release: Prisma.CommContactUpdateInput = {};
        if (!survivor.customerId && o.customerId && !links.customer) {
          links.customer = { connect: { id: o.customerId } };
          release.customer = { disconnect: true };
        }
        if (!survivor.staffId && o.staffId && !links.staff) {
          links.staff = { connect: { id: o.staffId } };
          release.staff = { disconnect: true };
        }
        if (!survivor.leadId && o.leadId && !links.lead) {
          links.lead = { connect: { id: o.leadId } };
        }
        if (Object.keys(release).length)
          clearLinks.push({ id: o.id, data: release });
      }
      for (const c of clearLinks)
        await tx.commContact.update({ where: { id: c.id }, data: c.data });

      await tx.commContactChannel.updateMany({
        where: { contactId: { in: ids } },
        data: { contactId: survivorId, isPrimary: false },
      });
      await tx.commConsentRecord.updateMany({
        where: { contactId: { in: ids } },
        data: { contactId: survivorId },
      });

      // Segment membership: add the survivor wherever a merged contact was a member.
      const members = await tx.commSegmentMember.findMany({
        where: { contactId: { in: ids } },
      });
      for (const m of members)
        await tx.commSegmentMember.upsert({
          where: {
            segmentId_contactId: {
              segmentId: m.segmentId,
              contactId: survivorId,
            },
          },
          create: { segmentId: m.segmentId, contactId: survivorId },
          update: {},
        });

      // Subscriptions: the most restrictive state per channel. Subscribed only if EVERY record that holds an address
      // on that channel was subscribed; any unsubscribe wins; a pending confirmation stays pending.
      for (const channel of ['WHATSAPP', 'EMAIL'] as CommChannel[]) {
        const type = channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
        const everyone = [survivor, ...others];
        const states = everyone.map(
          (p) =>
            p.subscriptions.find((s) => s.channel === channel)?.status ??
            'NONE',
        );
        const holders = everyone.filter((p) =>
          p.channels.some((c) => c.type === type),
        );
        const holderStates = holders.map(
          (p) =>
            p.subscriptions.find((s) => s.channel === channel)?.status ??
            'NONE',
        );
        let status: CommSubscriptionStatus = 'NONE';
        if (states.includes('UNSUBSCRIBED')) status = 'UNSUBSCRIBED';
        else if (
          holderStates.length > 0 &&
          holderStates.every((x) => x === 'SUBSCRIBED')
        )
          status = 'SUBSCRIBED';
        else if (states.includes('PENDING_CONFIRMATION'))
          status = 'PENDING_CONFIRMATION';
        if (states.every((x) => x === 'NONE')) continue;
        const topics = [
          ...new Set(
            everyone.flatMap(
              (p) =>
                p.subscriptions.find((s) => s.channel === channel)?.topics ??
                [],
            ),
          ),
        ];
        await tx.commSubscription.upsert({
          where: { contactId_channel: { contactId: survivorId, channel } },
          create: { contactId: survivorId, companyId, channel, status, topics },
          update: { status, topics },
        });
      }
      await tx.commSubscription.deleteMany({
        where: { contactId: { in: ids } },
      });

      await tx.commContact.update({
        where: { id: survivorId },
        data: {
          tags: [...tags],
          interests: [...interests],
          primaryPhone: phone,
          primaryEmail: email,
          ...links,
        },
      });
      await tx.commContact.updateMany({
        where: { id: { in: ids } },
        data: { status: 'MERGED', mergedIntoId: survivorId },
      });
      await tx.auditLog.create({
        data: {
          identityId: actor.identityId,
          companyId,
          action: 'comm.contacts_merged',
          entityType: 'CommContact',
          entityId: survivorId,
          metadata: { merged: ids },
        },
      });
    });
    return this.get(companyId, survivorId);
  }

  // ---------------------------------------------------------------------------------------------- import / export

  /**
   * CSV import. Creates contacts only - never a subscription: a file the company holds is not the person's consent
   * to marketing, whatever the file says. Rows with an address that already exists are reported as duplicates and
   * left untouched; an invalid row is reported with its line number.
   */
  async importCsv(
    companyId: string,
    csv: string,
    opts: { dryRun: boolean; source?: string },
    actor: Actor,
  ) {
    const records = csvRowsToRecords(parseCsv(csv));
    if (records.length === 0)
      throw new BadRequestException(
        'The file has no rows. The first line must be the column names.',
      );
    if (records.length > IMPORT_ROW_LIMIT)
      throw new BadRequestException(
        `A single import is limited to ${IMPORT_ROW_LIMIT} rows. Split the file.`,
      );
    const headers = Object.keys(records[0]);
    const pick = (r: Record<string, string>, ...names: string[]) => {
      for (const n of names) if (r[n]) return r[n];
      return '';
    };
    if (
      !headers.some((h) =>
        ['phone', 'mobile', 'whatsapp', 'email', 'e-mail'].includes(h),
      )
    )
      throw new BadRequestException(
        'The file needs a "phone" or an "email" column.',
      );

    const results: ImportRowResult[] = [];
    const seenInFile = new Set<string>();
    let created = 0;
    const source = opts.source?.trim() || 'CSV_IMPORT';

    for (const [i, r] of records.entries()) {
      const row = i + 2; // header is line 1
      const name = pick(r, 'name', 'full name', 'fullname', 'full_name');
      const phoneRaw = pick(r, 'phone', 'mobile', 'whatsapp', 'phone number');
      const emailRaw = pick(r, 'email', 'e-mail', 'email address');
      const phone = phoneRaw ? normalisePhone(phoneRaw) : null;
      const email = emailRaw ? normaliseEmail(emailRaw) : null;
      if (name.length < 2) {
        results.push({ row, outcome: 'INVALID', message: 'Name is missing.' });
        continue;
      }
      if (phoneRaw && !phone) {
        results.push({
          row,
          outcome: 'INVALID',
          message: `Phone "${phoneRaw}" is not valid.`,
        });
        continue;
      }
      if (emailRaw && !email) {
        results.push({
          row,
          outcome: 'INVALID',
          message: `Email "${emailRaw}" is not valid.`,
        });
        continue;
      }
      if (!phone && !email) {
        results.push({
          row,
          outcome: 'INVALID',
          message: 'Needs a phone number or an email.',
        });
        continue;
      }
      const keys = [phone && `p:${phone}`, email && `e:${email}`].filter(
        Boolean,
      ) as string[];
      if (keys.some((k) => seenInFile.has(k))) {
        results.push({
          row,
          outcome: 'DUPLICATE',
          message: 'Repeated earlier in this file.',
        });
        continue;
      }
      const existing = await this.findByAddresses(companyId, phone, email);
      if (existing.length > 1) {
        results.push({
          row,
          outcome: 'CONFLICT',
          message:
            'Its phone and email belong to two different existing contacts.',
        });
        continue;
      }
      if (existing.length === 1) {
        results.push({
          row,
          outcome: 'DUPLICATE',
          message: `Already exists as "${existing[0].fullName}".`,
        });
        keys.forEach((k) => seenInFile.add(k));
        continue;
      }
      keys.forEach((k) => seenInFile.add(k));
      if (!opts.dryRun) {
        const lang =
          LANGUAGE_ALIASES[(pick(r, 'language', 'lang') || '').toLowerCase()] ??
          'en';
        const kind =
          KIND_ALIASES[(pick(r, 'kind', 'type') || '').toLowerCase()] ??
          'OTHER';
        await this.insert(companyId, {
          fullName: name,
          phone,
          email,
          preferredLanguage: lang,
          country: pick(r, 'country') || undefined,
          source,
          kind,
          tags: pick(r, 'tags').split(/[;|]/).filter(Boolean),
          interests: pick(r, 'interests')
            .toUpperCase()
            .split(/[;|\s]+/)
            .filter(Boolean),
          actor,
        });
      }
      created++;
      results.push({ row, outcome: 'CREATED' });
    }

    const summary = {
      dryRun: opts.dryRun,
      rows: records.length,
      created,
      duplicates: results.filter((r) => r.outcome === 'DUPLICATE').length,
      invalid: results.filter((r) => r.outcome === 'INVALID').length,
      conflicts: results.filter((r) => r.outcome === 'CONFLICT').length,
      problems: results.filter((r) => r.outcome !== 'CREATED').slice(0, 100),
      consentNote:
        'Importing creates contacts only. Nobody is subscribed to WhatsApp or email marketing by an import; consent has to be given by the person.',
    };
    if (!opts.dryRun)
      await this.audit.record({
        identityId: actor.identityId,
        companyId,
        action: 'comm.contacts_imported',
        entityType: 'CommContact',
        metadata: { rows: summary.rows, created: summary.created, source },
      });
    return summary;
  }

  /** CSV of contacts with their current consent per channel. Protected: audited, capped, formula-safe. */
  async exportCsv(
    companyId: string,
    q: ListContactsQueryDto,
    actor: Actor,
  ): Promise<string> {
    const { total } = await this.list(companyId, {
      ...q,
      page: 1,
      pageSize: 1,
    });
    if (total > EXPORT_ROW_LIMIT)
      throw new BadRequestException(
        `An export is limited to ${EXPORT_ROW_LIMIT} contacts. Narrow the filters.`,
      );
    const rows: string[][] = [];
    for (let page = 1; rows.length < total; page++) {
      const batch = await this.list(companyId, { ...q, page, pageSize: 100 });
      if (batch.items.length === 0) break;
      for (const c of batch.items) {
        const sub = (ch: CommChannel) =>
          c.subscriptions.find((s) => s.channel === ch)?.status ?? 'NONE';
        rows.push([
          c.fullName,
          c.primaryPhone ?? '',
          c.primaryEmail ?? '',
          c.preferredLanguage,
          c.country ?? '',
          c.kind,
          c.tags.join(';'),
          c.interests.join(';'),
          sub('WHATSAPP'),
          sub('EMAIL'),
          c.source,
          c.createdAt.toISOString(),
        ]);
      }
    }
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.contacts_exported',
      entityType: 'CommContact',
      metadata: { count: rows.length },
    });
    return toCsv(
      [
        'name',
        'phone',
        'email',
        'language',
        'country',
        'kind',
        'tags',
        'interests',
        'whatsapp_marketing',
        'email_marketing',
        'source',
        'created',
      ],
      rows,
    );
  }

  // ---------------------------------------------------------------------------------------------- data subject requests

  /** Everything held about one contact, for an access request. */
  async dataSubjectExport(companyId: string, id: string, actor: Actor) {
    const contact = await this.get(companyId, id);
    const consent = await this.consent.history(companyId, id);
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.contact_dsr_export',
      entityType: 'CommContact',
      entityId: id,
    });
    return {
      contact,
      consentHistory: consent,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Erasure: personal fields are removed and the record is marked ERASED. The suppression entries (a keyed hash,
   * not the address) and the consent records (no personal data beyond the wording shown) are kept, so a person who
   * asked to be forgotten is never messaged again if the same address turns up in a later file.
   */
  async erase(companyId: string, id: string, actor: Actor) {
    const c = await this.prisma.commContact.findFirst({
      where: { id, companyId, status: { not: 'ERASED' } },
      include: { channels: true },
    });
    if (!c) throw new NotFoundException('Contact not found');
    await this.prisma.$transaction(async (tx) => {
      for (const ch of c.channels) {
        const channel: CommChannel = ch.type === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';
        {
          await tx.commSuppression.upsert({
            where: {
              companyId_channel_valueHash: {
                companyId,
                channel,
                valueHash: this.consent.hashAddress(channel, ch.value),
              },
            },
            create: {
              companyId,
              channel,
              valueHash: this.consent.hashAddress(channel, ch.value),
              valueHint: '(erased)',
              // The person's own "do not contact": only their own new consent lifts it.
              reason: 'UNSUBSCRIBED',
              source: 'ERASURE',
              createdByIdentityId: actor.identityId,
            },
            update: {},
          });
        }
      }
      await tx.commContactChannel.deleteMany({ where: { contactId: id } });
      await tx.commSegmentMember.deleteMany({ where: { contactId: id } });
      await tx.commSubscription.updateMany({
        where: { contactId: id },
        data: {
          status: 'UNSUBSCRIBED',
          topics: [],
          unsubscribedAt: new Date(),
        },
      });
      await tx.commContact.update({
        where: { id },
        data: {
          fullName: 'Erased contact',
          primaryPhone: null,
          primaryEmail: null,
          country: null,
          tags: [],
          interests: [],
          status: 'ERASED',
          customer: { disconnect: true },
          lead: { disconnect: true },
          staff: { disconnect: true },
          preferenceToken: newOpaqueToken(),
        },
      });
      await tx.auditLog.create({
        data: {
          identityId: actor.identityId,
          companyId,
          action: 'comm.contact_erased',
          entityType: 'CommContact',
          entityId: id,
        },
      });
    });
    return { erased: true };
  }
}
