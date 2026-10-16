import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CommCampaign,
  CommCampaignStatus,
  CommChannel,
  CommTemplate,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  ApprovalConfirmation,
  canTransition,
  confirmationMismatch,
  isEditable,
  missingCampaignValues,
  withinSizeLimit,
} from './comm-campaign.rules';
import { CommMessageBuilder, TemplateContent } from './comm-message.builder';
import { CommOutboundService } from './comm-outbound.service';
import { sanitizeHtml, extractVariables } from './comm-render';
import { CommSegmentsService } from './comm-segments.service';
import { CommSettingsService } from './comm-settings.service';
import { SAMPLE_VALUES } from './comm-templates.service';
import { normaliseEmail, normalisePhone } from './comm-identifiers';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/comm-campaign.dto';
import { WhatsAppProviderRouter } from '../whatsapp/providers/whatsapp-provider.router';

export interface Actor {
  identityId: string;
  roles: string[];
  email?: string | null;
}

const LIVE_STATUSES: CommCampaignStatus[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'SENDING',
  'PAUSED',
];

@Injectable()
export class CommCampaignsService {
  private readonly logger = new Logger(CommCampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: CommSettingsService,
    private readonly segments: CommSegmentsService,
    private readonly builder: CommMessageBuilder,
    private readonly outbound: CommOutboundService,
    private readonly whatsapp: WhatsAppProviderRouter,
  ) {}

  // ---------------------------------------------------------------------------------------------- reads

  async list(
    companyId: string,
    q: {
      channel?: CommChannel;
      status?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const where: Prisma.CommCampaignWhereInput = {
      companyId,
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.status ? { status: q.status as CommCampaignStatus } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.commCampaign.count({ where }),
      this.prisma.commCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          segment: { select: { id: true, name: true } },
          template: {
            select: {
              id: true,
              name: true,
              key: true,
              language: true,
              approval: true,
            },
          },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async get(companyId: string, id: string) {
    const c = await this.prisma.commCampaign.findFirst({
      where: { id, companyId },
      include: {
        segment: { select: { id: true, name: true, kind: true } },
        template: true,
      },
    });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  private async raw(companyId: string, id: string): Promise<CommCampaign> {
    const c = await this.prisma.commCampaign.findFirst({
      where: { id, companyId },
    });
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  // ---------------------------------------------------------------------------------------------- validation helpers

  private async checkTopic(companyId: string, topic: string): Promise<void> {
    if (topic === 'general') return;
    const s = await this.settings.get(companyId);
    if (!this.settings.topics(s).some((t) => t.key === topic))
      throw new BadRequestException('That topic is not offered.');
  }

  private async checkRefs(
    companyId: string,
    channel: CommChannel,
    segmentId?: string | null,
    templateId?: string | null,
  ) {
    if (segmentId) await this.segments.get(companyId, segmentId);
    if (templateId) {
      const t = await this.prisma.commTemplate.findFirst({
        where: { id: templateId, companyId, isActive: true },
      });
      if (!t)
        throw new BadRequestException(
          'That template does not exist or has been retired.',
        );
      if (t.channel !== channel)
        throw new BadRequestException(
          `That is a ${t.channel.toLowerCase()} template; this campaign is ${channel.toLowerCase()}.`,
        );
      if (t.category !== 'MARKETING')
        throw new BadRequestException(
          'Campaigns are promotional. Service templates (booking updates, payment reminders ...) are sent automatically for the booking they belong to.',
        );
    }
  }

  private checkSchedule(scheduledAt?: string | null): Date | null {
    if (!scheduledAt) return null;
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime()))
      throw new BadRequestException('That date is not valid.');
    if (d.getTime() < Date.now() + 60_000)
      throw new BadRequestException(
        'Choose a time at least a minute from now.',
      );
    return d;
  }

  private cleanVariables(
    v?: Record<string, string>,
  ): Record<string, string> | undefined {
    if (!v) return undefined;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(k) || typeof val !== 'string')
        throw new BadRequestException(`"${k}" is not a valid value name.`);
      out[k] = val.slice(0, 1000);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- create / update

  async create(
    companyId: string,
    dto: CreateCampaignDto,
    actor: Actor,
    branchId?: string,
  ) {
    const topic = dto.topic ?? 'general';
    await this.checkTopic(companyId, topic);
    await this.checkRefs(companyId, dto.channel, dto.segmentId, dto.templateId);
    const scheduledAt = this.checkSchedule(dto.scheduledAt);
    if (
      dto.channel === 'WHATSAPP' &&
      (dto.subject || dto.bodyHtml || dto.bodyText)
    )
      throw new BadRequestException(
        'A WhatsApp campaign uses a message template. Write or choose one under Message Templates.',
      );
    const settings = await this.settings.get(companyId);
    const row = await this.prisma.commCampaign.create({
      data: {
        companyId,
        branchId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        channel: dto.channel,
        topic,
        segmentId: dto.segmentId ?? null,
        templateId: dto.templateId ?? null,
        subject: dto.channel === 'EMAIL' ? dto.subject?.trim() || null : null,
        bodyHtml:
          dto.channel === 'EMAIL' && dto.bodyHtml
            ? sanitizeHtml(dto.bodyHtml)
            : null,
        bodyText: dto.channel === 'EMAIL' ? (dto.bodyText ?? null) : null,
        variables: this.cleanVariables(dto.variables) ?? undefined,
        scheduledAt,
        timezone: settings.businessTimezone,
        createdByIdentityId: actor.identityId,
      },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_created',
      entityType: 'CommCampaign',
      entityId: row.id,
      metadata: { channel: row.channel },
    });
    return row;
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateCampaignDto,
    actor: Actor,
  ) {
    const c = await this.raw(companyId, id);
    if (!isEditable(c.status))
      throw new ConflictException(
        'Only a draft can be edited. Send a pending campaign back to draft first.',
      );
    if (dto.topic) await this.checkTopic(companyId, dto.topic);
    await this.checkRefs(companyId, c.channel, dto.segmentId, dto.templateId);
    const data: Prisma.CommCampaignUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    if (dto.topic !== undefined) data.topic = dto.topic;
    if (dto.segmentId !== undefined) data.segmentId = dto.segmentId || null;
    if (dto.templateId !== undefined) data.templateId = dto.templateId || null;
    if (c.channel === 'EMAIL') {
      if (dto.subject !== undefined) data.subject = dto.subject.trim() || null;
      if (dto.bodyHtml !== undefined)
        data.bodyHtml = dto.bodyHtml ? sanitizeHtml(dto.bodyHtml) : null;
      if (dto.bodyText !== undefined) data.bodyText = dto.bodyText || null;
    } else if (dto.subject || dto.bodyHtml || dto.bodyText) {
      throw new BadRequestException(
        'A WhatsApp campaign uses a message template.',
      );
    }
    if (dto.variables !== undefined)
      data.variables = this.cleanVariables(dto.variables) ?? {};
    if (dto.scheduledAt !== undefined)
      data.scheduledAt = this.checkSchedule(dto.scheduledAt);
    const row = await this.prisma.commCampaign.update({ where: { id }, data });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_updated',
      entityType: 'CommCampaign',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return row;
  }

  async remove(companyId: string, id: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'DRAFT')
      throw new ConflictException(
        'Only a draft can be deleted. Cancel a campaign that is further along; its history is kept.',
      );
    await this.prisma.commCampaign.delete({ where: { id } });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_deleted',
      entityType: 'CommCampaign',
      entityId: id,
    });
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------------------------- content and issues

  /** The text this campaign sends: the template (or the campaign's own email text) and what it needs filled in. */
  async contentOf(
    c: CommCampaign & { template?: CommTemplate | null },
  ): Promise<TemplateContent> {
    const t =
      c.template ??
      (c.templateId
        ? await this.prisma.commTemplate.findUnique({
            where: { id: c.templateId },
          })
        : null);
    if (t)
      return {
        subject: t.subject,
        bodyHtml: t.bodyHtml,
        bodyText: t.bodyText,
        variables: t.variables,
        whatsappTemplateName: t.whatsappTemplateName,
        language: t.language,
      };
    const variables = extractVariables(c.subject, c.bodyHtml, c.bodyText);
    return {
      subject: c.subject,
      bodyHtml: c.bodyHtml,
      bodyText: c.bodyText ?? '',
      variables,
      whatsappTemplateName: null,
      language: 'en',
    };
  }

  /** Everything that stops this campaign being submitted, in plain words. An empty list means it is ready. */
  async issues(companyId: string, c: CommCampaign): Promise<string[]> {
    const out: string[] = [];
    if (!c.segmentId) out.push('Choose who it goes to (a segment).');
    if (c.channel === 'WHATSAPP' && !c.templateId)
      out.push('Choose a WhatsApp message template.');
    if (c.channel === 'EMAIL') {
      if (!c.templateId && !(c.subject && (c.bodyHtml || c.bodyText)))
        out.push('Write the email (subject and body) or choose a template.');
    }
    if (c.templateId || c.subject) {
      const content = await this.contentOf(c);
      const vars = (c.variables as Record<string, string> | null) ?? {};
      for (const m of missingCampaignValues(content.variables, vars))
        out.push(`Give a value for {{${m}}}.`);
    }
    if (c.templateId && c.channel === 'WHATSAPP') {
      const t = await this.prisma.commTemplate.findUnique({
        where: { id: c.templateId },
      });
      const mode = await this.whatsapp.activeProviderName();
      if (mode === 'meta' && t?.approval !== 'APPROVED')
        out.push('This WhatsApp template has not been approved by Meta yet.');
    }
    return out;
  }

  async preview(companyId: string, id: string) {
    const c = await this.get(companyId, id);
    const content = await this.contentOf(c);
    const settings = await this.settings.get(companyId);
    const values = {
      ...SAMPLE_VALUES,
      ...((c.variables as Record<string, string> | null) ?? {}),
    };
    const built = this.builder.build({
      channel: c.channel,
      marketing: true,
      content,
      contact: {
        fullName: 'Amina Yusuf',
        preferenceToken: 'SAMPLE-TOKEN-0000000',
      },
      values,
      senderName: settings.senderName,
    });
    const audience = c.segmentId
      ? await this.segments.audienceFor(
          companyId,
          c.segmentId,
          c.channel,
          c.topic,
        )
      : null;
    const issues = await this.issues(companyId, c);
    const mode =
      c.channel === 'EMAIL'
        ? await this.outbound.emailHealth()
        : await this.outbound.whatsappHealth();
    return {
      sample: true,
      message:
        built.channel === 'EMAIL'
          ? { subject: built.subject, html: built.html, text: built.text }
          : {
              text: built.previewText,
              templateName: built.templateName,
              language: built.language,
            },
      audience: audience && {
        total: audience.total,
        eligible: audience.eligible,
        excluded: audience.excluded,
        breakdown: audience.breakdown,
      },
      issues,
      provider: { mode: mode.mode, provider: mode.provider },
      settings: {
        testMode: settings.testMode,
        killSwitch: settings.killSwitch,
        approvalRequired: settings.approvalRequired,
      },
    };
  }

  // ---------------------------------------------------------------------------------------------- workflow

  private async transition(
    companyId: string,
    id: string,
    from: CommCampaignStatus[],
    to: CommCampaignStatus,
    data: Prisma.CommCampaignUncheckedUpdateManyInput = {},
  ) {
    const r = await this.prisma.commCampaign.updateMany({
      where: { id, companyId, status: { in: from } },
      data: { status: to, ...data },
    });
    if (r.count !== 1)
      throw new ConflictException(
        'This campaign changed while you were working on it. Reload and try again.',
      );
  }

  private async freezeCounts(companyId: string, c: CommCampaign) {
    const a = await this.segments.audienceFor(
      companyId,
      c.segmentId!,
      c.channel,
      c.topic,
    );
    return a;
  }

  /** The author puts a ready campaign forward for approval (or straight to approved when the company does not require it). */
  async submit(companyId: string, id: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'DRAFT')
      throw new ConflictException('Only a draft can be submitted.');
    const issues = await this.issues(companyId, c);
    if (issues.length)
      throw new BadRequestException(`Not ready yet: ${issues.join(' ')}`);
    const settings = await this.settings.get(companyId);
    const audience = await this.freezeCounts(companyId, c);
    if (audience.eligible === 0)
      throw new BadRequestException(
        'Nobody in this segment can receive it: nobody has consented on this channel for this topic. See the breakdown in the preview.',
      );
    const limit = this.settings.maxCampaignSize(settings, actor.roles);
    if (!withinSizeLimit(limit, audience.eligible).allowed)
      throw new ForbiddenException(
        `This would reach ${audience.eligible} people; your role may send to ${limit}. Ask a higher role to submit it.`,
      );
    const counts = {
      totalSelected: audience.total,
      eligibleCount: audience.eligible,
      excludedCount: audience.excluded,
      exclusionBreakdown: audience.breakdown as Prisma.InputJsonValue,
    };
    if (settings.approvalRequired) {
      await this.transition(companyId, id, ['DRAFT'], 'PENDING_APPROVAL', {
        ...counts,
        rejectedReason: null,
      });
    } else {
      await this.transition(companyId, id, ['DRAFT'], 'APPROVED', {
        ...counts,
        approvedByIdentityId: actor.identityId,
        approvedAt: new Date(),
        approvalNote: "Approval is not required by this company's settings.",
      });
    }
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_submitted',
      entityType: 'CommCampaign',
      entityId: id,
      metadata: { eligible: audience.eligible, excluded: audience.excluded },
    });
    return this.get(companyId, id);
  }

  /**
   * A second person approves. They must state back exactly what they are approving (channel, topic, segment, template,
   * schedule and the number of people who will get it), the audience is counted again from live consent records, and
   * the size limit of the approver's own role applies. The author can never approve their own campaign.
   */
  async approve(
    companyId: string,
    id: string,
    confirm: ApprovalConfirmation,
    note: string | undefined,
    actor: Actor,
  ) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'PENDING_APPROVAL')
      throw new ConflictException('This campaign is not waiting for approval.');
    if (c.createdByIdentityId === actor.identityId)
      throw new ForbiddenException(
        'You cannot approve a campaign you wrote. Ask a colleague.',
      );
    const audience = await this.freezeCounts(companyId, c);
    const mismatch = confirmationMismatch(confirm, c, audience.eligible);
    if (mismatch === 'audience')
      throw new ConflictException(
        `The audience changed since you looked: ${audience.eligible} people can receive it now. Review it again.`,
      );
    if (mismatch)
      throw new ConflictException(
        `What you confirmed does not match the campaign (${mismatch}). Reload and review it again.`,
      );
    const settings = await this.settings.get(companyId);
    const limit = this.settings.maxCampaignSize(settings, actor.roles);
    if (!withinSizeLimit(limit, audience.eligible).allowed)
      throw new ForbiddenException(
        `This reaches ${audience.eligible} people; your role may approve up to ${limit}. A higher role must approve it.`,
      );
    const issues = await this.issues(companyId, c);
    if (issues.length)
      throw new BadRequestException(`Cannot approve: ${issues.join(' ')}`);
    await this.transition(companyId, id, ['PENDING_APPROVAL'], 'APPROVED', {
      approvedByIdentityId: actor.identityId,
      approvedAt: new Date(),
      approvalNote: note ?? null,
      totalSelected: audience.total,
      eligibleCount: audience.eligible,
      excludedCount: audience.excluded,
      exclusionBreakdown: audience.breakdown as Prisma.InputJsonValue,
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_approved',
      entityType: 'CommCampaign',
      entityId: id,
      reason: note,
      metadata: { eligible: audience.eligible },
    });
    return this.get(companyId, id);
  }

  async reject(companyId: string, id: string, reason: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'PENDING_APPROVAL')
      throw new ConflictException('This campaign is not waiting for approval.');
    if (c.createdByIdentityId === actor.identityId)
      throw new ForbiddenException(
        'Withdraw your own campaign instead of rejecting it.',
      );
    await this.transition(companyId, id, ['PENDING_APPROVAL'], 'DRAFT', {
      rejectedReason: reason,
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_rejected',
      entityType: 'CommCampaign',
      entityId: id,
      reason,
    });
    return this.get(companyId, id);
  }

  /** The author takes a pending or approved campaign back to draft to change it. */
  async withdraw(companyId: string, id: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (!canTransition(c.status, 'DRAFT') || c.status === 'SCHEDULED')
      throw new ConflictException(
        'This campaign can no longer be taken back to draft.',
      );
    await this.transition(
      companyId,
      id,
      ['PENDING_APPROVAL', 'APPROVED'],
      'DRAFT',
      { approvedByIdentityId: null, approvedAt: null, approvalNote: null },
    );
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_withdrawn',
      entityType: 'CommCampaign',
      entityId: id,
    });
    return this.get(companyId, id);
  }

  /** Starts an approved campaign now, or schedules it for its chosen time. */
  async start(companyId: string, id: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'APPROVED')
      throw new ConflictException('Only an approved campaign can be started.');
    const settings = await this.settings.get(companyId);
    if (settings.killSwitch)
      throw new ConflictException(
        'The kill switch is on. Switch it off in the settings before sending.',
      );
    if (c.scheduledAt && c.scheduledAt.getTime() > Date.now() + 30_000) {
      await this.transition(companyId, id, ['APPROVED'], 'SCHEDULED');
      await this.audit.record({
        identityId: actor.identityId,
        companyId,
        action: 'comm.campaign_scheduled',
        entityType: 'CommCampaign',
        entityId: id,
        metadata: { at: c.scheduledAt.toISOString() },
      });
      return this.get(companyId, id);
    }
    await this.beginSending(companyId, id, actor.identityId);
    return this.get(companyId, id);
  }

  /**
   * Freezes the audience and opens the queue. The people queued are those who may receive it RIGHT NOW; each is
   * checked again at the moment of sending, so anyone who unsubscribes in between is skipped.
   */
  async beginSending(companyId: string, id: string, actorIdentityId?: string) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'APPROVED' && c.status !== 'SCHEDULED') return;
    const audience = await this.segments.audienceFor(
      companyId,
      c.segmentId!,
      c.channel,
      c.topic,
      true,
    );
    const simulated =
      c.channel === 'EMAIL'
        ? (await this.outbound.emailHealth()).mode === 'SIMULATOR'
        : (await this.outbound.whatsappHealth()).mode === 'SIMULATOR';
    // Claim the transition first so two workers cannot both queue the same campaign.
    const claimed = await this.prisma.commCampaign.updateMany({
      where: { id, companyId, status: { in: ['APPROVED', 'SCHEDULED'] } },
      data: {
        status: 'SENDING',
        startedAt: new Date(),
        audienceFrozenAt: new Date(),
        simulated,
        totalSelected: audience.total,
        eligibleCount: audience.eligible,
        excludedCount: audience.excluded,
        exclusionBreakdown: audience.breakdown,
      },
    });
    if (claimed.count !== 1) return;
    const ids = audience.eligibleIds ?? [];
    for (let i = 0; i < ids.length; i += 1000)
      await this.prisma.commCampaignRecipient.createMany({
        data: ids.slice(i, i + 1000).map((contactId) => ({
          campaignId: id,
          companyId,
          contactId,
          simulated,
        })),
        skipDuplicates: true,
      });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.campaign_started',
      entityType: 'CommCampaign',
      entityId: id,
      metadata: { queued: ids.length, excluded: audience.excluded, simulated },
    });
    this.logger.log(
      `Campaign ${id} started: ${ids.length} queued, ${audience.excluded} left out${simulated ? ' (simulated provider)' : ''}`,
    );
  }

  async pause(companyId: string, id: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (!canTransition(c.status, 'PAUSED'))
      throw new ConflictException('This campaign cannot be paused now.');
    await this.transition(companyId, id, ['SENDING', 'SCHEDULED'], 'PAUSED', {
      pausedAt: new Date(),
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_paused',
      entityType: 'CommCampaign',
      entityId: id,
    });
    return this.get(companyId, id);
  }

  async resume(companyId: string, id: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (c.status !== 'PAUSED')
      throw new ConflictException('This campaign is not paused.');
    const settings = await this.settings.get(companyId);
    if (settings.killSwitch)
      throw new ConflictException(
        'The kill switch is on. Switch it off in the settings first.',
      );
    // A campaign paused before its audience was frozen goes back to waiting for its time.
    const frozen = !!c.audienceFrozenAt;
    await this.transition(
      companyId,
      id,
      ['PAUSED'],
      frozen ? 'SENDING' : 'SCHEDULED',
      { pausedAt: null },
    );
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_resumed',
      entityType: 'CommCampaign',
      entityId: id,
    });
    return this.get(companyId, id);
  }

  async cancel(companyId: string, id: string, reason: string, actor: Actor) {
    const c = await this.raw(companyId, id);
    if (!canTransition(c.status, 'CANCELLED'))
      throw new ConflictException('This campaign can no longer be cancelled.');
    await this.transition(
      companyId,
      id,
      [
        'DRAFT',
        'PENDING_APPROVAL',
        'APPROVED',
        'SCHEDULED',
        'SENDING',
        'PAUSED',
      ],
      'CANCELLED',
      { cancelledAt: new Date(), cancelReason: reason },
    );
    // Anything not yet handed to the provider is cancelled; what has been sent stays on record.
    const r = await this.prisma.commCampaignRecipient.updateMany({
      where: { campaignId: id, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_cancelled',
      entityType: 'CommCampaign',
      entityId: id,
      reason,
      metadata: { cancelledRecipients: r.count },
    });
    return this.get(companyId, id);
  }

  // ---------------------------------------------------------------------------------------------- test send

  /** One labelled message to the caller's own address or a configured test recipient. Never touches consent or the queue. */
  async testSend(companyId: string, id: string, toRaw: string, actor: Actor) {
    const c = await this.get(companyId, id);
    const settings = await this.settings.get(companyId);
    const content = await this.contentOf(c);
    const issues = (await this.issues(companyId, c)).filter(
      (i) => !i.startsWith('Choose who'),
    );
    if (issues.length)
      throw new BadRequestException(`Not ready to test: ${issues.join(' ')}`);
    const values = {
      ...SAMPLE_VALUES,
      ...((c.variables as Record<string, string> | null) ?? {}),
    };
    const built = this.builder.build({
      channel: c.channel,
      marketing: true,
      content,
      contact: {
        fullName: 'Test Recipient',
        preferenceToken: 'TEST-ONLY-NOT-A-REAL-LINK',
      },
      values,
      senderName: settings.senderName,
    });
    if (c.channel === 'EMAIL') {
      const to = normaliseEmail(toRaw);
      if (!to)
        throw new BadRequestException('That is not a valid email address.');
      const allowed = new Set(
        [
          actor.email?.toLowerCase(),
          ...settings.testRecipients.map((x) => x.toLowerCase()),
        ].filter(Boolean),
      );
      if (!allowed.has(to))
        throw new ForbiddenException(
          'A test can only go to your own address or one of the test recipients in the settings.',
        );
      if (built.channel !== 'EMAIL') throw new Error('unreachable');
      const r = await this.outbound.sendEmail({
        to,
        subject: `[TEST] ${built.subject}`,
        html: built.html,
        text: built.text,
        replyTo: settings.replyTo ?? undefined,
        fromName: settings.senderName,
      });
      await this.audit.record({
        identityId: actor.identityId,
        companyId,
        action: 'comm.campaign_test_sent',
        entityType: 'CommCampaign',
        entityId: id,
        metadata: { channel: 'EMAIL', ok: r.ok },
      });
      return { sent: r.ok, simulated: r.simulated, error: r.error };
    }
    const to = normalisePhone(toRaw);
    if (!to) throw new BadRequestException('That is not a valid phone number.');
    const allowedPhones = new Set(
      settings.testRecipients.map((x) => normalisePhone(x)).filter(Boolean),
    );
    if (!allowedPhones.has(to))
      throw new ForbiddenException(
        'Add this number to the test recipients in the settings first.',
      );
    if (built.channel !== 'WHATSAPP') throw new Error('unreachable');
    const r = await this.outbound.sendWhatsAppTemplate({
      to,
      templateName: built.templateName,
      language: built.language,
      variables: built.variables,
    });
    await this.audit.record({
      identityId: actor.identityId,
      companyId,
      action: 'comm.campaign_test_sent',
      entityType: 'CommCampaign',
      entityId: id,
      metadata: { channel: 'WHATSAPP', ok: r.ok },
    });
    return { sent: r.ok, simulated: r.simulated, error: r.error };
  }

  // ---------------------------------------------------------------------------------------------- reporting

  async report(companyId: string, id: string) {
    const c = await this.get(companyId, id);
    const groups = await this.prisma.commCampaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const count = (s: string) =>
      groups.find((g) => g.status === s)?._count._all ?? 0;
    const skipReasons = await this.prisma.commCampaignRecipient.groupBy({
      by: ['skipReason'],
      where: { campaignId: id, status: 'SKIPPED' },
      _count: { _all: true },
    });
    const [clicked, bounced, complained, unsubscribed, failedReasons] =
      await Promise.all([
        this.prisma.commCampaignRecipient.count({
          where: { campaignId: id, clickedAt: { not: null } },
        }),
        this.prisma.commCampaignRecipient.count({
          where: { campaignId: id, bouncedAt: { not: null } },
        }),
        this.prisma.commCampaignRecipient.count({
          where: { campaignId: id, complainedAt: { not: null } },
        }),
        this.prisma.commCampaignRecipient.count({
          where: { campaignId: id, unsubscribedAt: { not: null } },
        }),
        this.prisma.commCampaignRecipient.groupBy({
          by: ['lastError'],
          where: { campaignId: id, status: 'FAILED' },
          _count: { _all: true },
          orderBy: { _count: { lastError: 'desc' } },
          take: 5,
        }),
      ]);
    const delivered = count('DELIVERED') + count('READ');
    // "Sent" for a funnel means handed to the provider and accepted, whatever happened afterwards.
    const accepted = count('SENT') + delivered;
    const providerReports =
      c.channel === 'WHATSAPP'
        ? { delivered: true, read: true, clicked: false }
        : { delivered: true, read: false, clicked: true };
    return {
      campaign: {
        id: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        topic: c.topic,
        simulated: c.simulated,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        scheduledAt: c.scheduledAt,
      },
      audience: {
        selected: c.totalSelected,
        eligible: c.eligibleCount,
        excluded: c.excludedCount,
        exclusionBreakdown: c.exclusionBreakdown ?? {},
      },
      queue: {
        queued: count('QUEUED'),
        sending: count('SENDING'),
        cancelled: count('CANCELLED'),
      },
      outcome: {
        accepted,
        delivered,
        read: count('READ'),
        failed: count('FAILED'),
        skippedAtSend: count('SKIPPED'),
        needsReview: count('UNCERTAIN'),
        bounced,
        complained,
        unsubscribed,
        clicked,
      },
      skipReasons: skipReasons.map((s) => ({
        reason: s.skipReason ?? 'UNKNOWN',
        count: s._count._all,
      })),
      failureReasons: failedReasons.map((f) => ({
        reason: f.lastError ?? 'Unknown',
        count: f._count._all,
      })),
      // What the provider can tell us at all. A figure the provider never reports is never shown as zero or estimated.
      providerReports,
      note:
        (c.simulated
          ? 'Sent through the built-in simulator: nothing was delivered to anyone. '
          : '') +
        (c.channel === 'EMAIL'
          ? 'Opens are not tracked. Clicks are shown only when the email provider reports them.'
          : 'Delivery and read receipts are shown only as reported by WhatsApp.'),
    };
  }

  async recipients(
    companyId: string,
    id: string,
    q: { status?: string; page?: number; pageSize?: number },
  ) {
    await this.raw(companyId, id);
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 25, 100);
    const where: Prisma.CommCampaignRecipientWhereInput = {
      campaignId: id,
      ...(q.status ? { status: q.status as never } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.commCampaignRecipient.count({ where }),
      this.prisma.commCampaignRecipient.findMany({
        where,
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          skipReason: true,
          attempts: true,
          lastError: true,
          sentAt: true,
          deliveredAt: true,
          readAt: true,
          failedAt: true,
          simulated: true,
          contact: { select: { id: true, fullName: true } },
        },
      }),
    ]);
    return { total, page, pageSize, items };
  }

  /** Counts across all campaigns, for the overview and the delivery-report page. */
  async summary(companyId: string) {
    const byStatus = await this.prisma.commCampaign.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { _all: true },
    });
    const recent = await this.prisma.commCampaign.findMany({
      where: {
        companyId,
        status: { in: ['SENDING', 'COMPLETED', 'FAILED', 'PAUSED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        simulated: true,
        eligibleCount: true,
        startedAt: true,
        completedAt: true,
      },
    });
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const inbound = await this.prisma.commInboundLog.groupBy({
      by: ['intent'],
      where: { companyId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const uncertain = await this.prisma.commCampaignRecipient.count({
      where: { companyId, status: 'UNCERTAIN' },
    });
    return {
      byStatus: Object.fromEntries(
        byStatus.map((g) => [g.status, g._count._all]),
      ),
      // What people wrote to us in the last 30 days, by what it was understood to be (no message text is kept here).
      inbound: Object.fromEntries(
        inbound.map((g) => [g.intent, g._count._all]),
      ),
      needsReview: uncertain,
      live: byStatus
        .filter((g) => LIVE_STATUSES.includes(g.status))
        .reduce((n, g) => n + g._count._all, 0),
      recent,
    };
  }
}
