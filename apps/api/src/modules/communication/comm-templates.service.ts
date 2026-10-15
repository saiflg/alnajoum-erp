import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CommChannel, CommTemplate, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommOutboundService } from './comm-outbound.service';
import {
  assertVariablesAllowed,
  buildEmail,
  extractVariables,
  renderText,
  sanitizeHtml,
} from './comm-render';
import { DEFAULT_TEMPLATES } from './comm-template.defaults';
import { WhatsAppProviderRouter } from '../whatsapp/providers/whatsapp-provider.router';

export interface TemplateInput {
  key: string;
  name: string;
  channel: CommChannel;
  category: 'MARKETING' | 'UTILITY' | 'TRANSACTIONAL';
  language: string;
  subject?: string;
  bodyHtml?: string;
  bodyText: string;
  whatsappTemplateName?: string;
}

/** Sample values for previews. Obviously fake, so a preview can never be mistaken for a real message. */
export const SAMPLE_VALUES: Record<string, string> = {
  first_name: 'Amina',
  name: 'Amina Yusuf',
  company_name: 'Alnajoum Travel Agency',
  offer: '[offer text goes here]',
  package_name: '[package name]',
  price: '[price]',
  destination: '[destination]',
  departure_date: '[departure date]',
  valid_until: '[valid until]',
  link: 'https://example.invalid/offer',
  contact_phone: '[office phone]',
  message: '[your message goes here]',
  booking_ref: 'SAMPLE-0001',
  amount: '[amount]',
  due_date: '[due date]',
  status: '[status]',
  document_name: '[document]',
};

@Injectable()
export class CommTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbound: CommOutboundService,
    private readonly whatsapp: WhatsAppProviderRouter,
  ) {}

  /** The starter templates, created once per company. Existing ones are never overwritten. */
  async ensureDefaults(companyId: string): Promise<void> {
    const count = await this.prisma.commTemplate.count({
      where: { companyId },
    });
    if (count > 0) return;
    await this.prisma.commTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((t) => {
        const key = t.channel === 'WHATSAPP' ? `wa_${t.key}` : t.key;
        return {
          companyId,
          key,
          name: t.name,
          channel: t.channel,
          category: t.category,
          language: t.language,
          subject: t.subject ?? null,
          bodyHtml: t.bodyHtml ? sanitizeHtml(t.bodyHtml) : null,
          bodyText: t.bodyText,
          variables: extractVariables(t.subject, t.bodyHtml, t.bodyText),
          whatsappTemplateName:
            t.channel === 'WHATSAPP' ? `alnajoum_${t.key}` : null,
          approval:
            t.channel === 'WHATSAPP'
              ? ('DRAFT' as const)
              : ('NOT_REQUIRED' as const),
        };
      }),
      skipDuplicates: true,
    });
  }

  async list(
    companyId: string,
    q: { channel?: CommChannel; category?: string; includeInactive?: boolean },
  ) {
    await this.ensureDefaults(companyId);
    return this.prisma.commTemplate.findMany({
      where: {
        companyId,
        ...(q.channel ? { channel: q.channel } : {}),
        ...(q.category
          ? { category: q.category as CommTemplate['category'] }
          : {}),
        ...(q.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ channel: 'asc' }, { name: 'asc' }, { language: 'asc' }],
      take: 300,
    });
  }

  async get(companyId: string, id: string): Promise<CommTemplate> {
    const t = await this.prisma.commTemplate.findFirst({
      where: { id, companyId },
    });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  private validate(t: TemplateInput): {
    variables: string[];
    bodyHtml: string | null;
  } {
    const variables = extractVariables(t.subject, t.bodyHtml, t.bodyText);
    assertVariablesAllowed(variables, t.category, t.channel);
    if (t.channel === 'EMAIL') {
      if (!t.subject?.trim())
        throw new BadRequestException('An email template needs a subject.');
      return {
        variables,
        bodyHtml: t.bodyHtml ? sanitizeHtml(t.bodyHtml) : null,
      };
    }
    if (t.bodyHtml)
      throw new BadRequestException('A WhatsApp template is plain text.');
    if (t.bodyText.length > 1024)
      throw new BadRequestException(
        'A WhatsApp template body is limited to 1024 characters.',
      );
    if (
      variables.some(
        (v) => v === 'unsubscribe_link' || v === 'preferences_link',
      )
    )
      throw new BadRequestException(
        'WhatsApp templates do not use unsubscribe links; people reply STOP.',
      );
    if (
      !t.whatsappTemplateName ||
      !/^[a-z0-9_]{1,200}$/.test(t.whatsappTemplateName)
    )
      throw new BadRequestException(
        'A WhatsApp template needs its provider name: lower-case letters, digits and underscores.',
      );
    if (
      t.category === 'MARKETING' &&
      !/stop|unsubscribe|opt out/i.test(t.bodyText)
    )
      throw new BadRequestException(
        'A promotional WhatsApp template must tell people how to opt out (for example “Reply STOP to unsubscribe”).',
      );
    return { variables, bodyHtml: null };
  }

  async create(
    companyId: string,
    input: TemplateInput,
    actorIdentityId: string,
  ) {
    const v = this.validate(input);
    try {
      const row = await this.prisma.commTemplate.create({
        data: {
          companyId,
          key: input.key,
          name: input.name.trim(),
          channel: input.channel,
          category: input.category,
          language: input.language,
          subject: input.channel === 'EMAIL' ? input.subject!.trim() : null,
          bodyHtml: v.bodyHtml,
          bodyText: input.bodyText,
          variables: v.variables,
          whatsappTemplateName:
            input.channel === 'WHATSAPP' ? input.whatsappTemplateName : null,
          approval: input.channel === 'WHATSAPP' ? 'DRAFT' : 'NOT_REQUIRED',
          createdByIdentityId: actorIdentityId,
        },
      });
      await this.audit.record({
        identityId: actorIdentityId,
        companyId,
        action: 'comm.template_created',
        entityType: 'CommTemplate',
        entityId: row.id,
      });
      return row;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException(
          'A template with this key and language already exists.',
        );
      throw e;
    }
  }

  async update(
    companyId: string,
    id: string,
    patch: Partial<Omit<TemplateInput, 'key' | 'channel' | 'language'>> & {
      isActive?: boolean;
    },
    actorIdentityId: string,
  ) {
    const cur = await this.get(companyId, id);
    const merged: TemplateInput = {
      key: cur.key,
      name: patch.name ?? cur.name,
      channel: cur.channel,
      category: patch.category ?? cur.category,
      language: cur.language,
      subject: patch.subject ?? cur.subject ?? undefined,
      bodyHtml: patch.bodyHtml ?? cur.bodyHtml ?? undefined,
      bodyText: patch.bodyText ?? cur.bodyText,
      whatsappTemplateName:
        patch.whatsappTemplateName ?? cur.whatsappTemplateName ?? undefined,
    };
    const v = this.validate(merged);
    // A change to approved WhatsApp wording needs a new review: the old approval was for the old text.
    const wordingChanged =
      cur.channel === 'WHATSAPP' &&
      (merged.bodyText !== cur.bodyText ||
        merged.whatsappTemplateName !== cur.whatsappTemplateName);
    const data: Prisma.CommTemplateUpdateInput = {
      name: merged.name,
      category: merged.category,
      subject: cur.channel === 'EMAIL' ? merged.subject : null,
      bodyHtml: v.bodyHtml,
      bodyText: merged.bodyText,
      variables: v.variables,
      whatsappTemplateName:
        cur.channel === 'WHATSAPP' ? merged.whatsappTemplateName : null,
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(wordingChanged && cur.approval !== 'DRAFT'
        ? { approval: 'DRAFT' }
        : {}),
    };
    const row = await this.prisma.commTemplate.update({ where: { id }, data });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.template_updated',
      entityType: 'CommTemplate',
      entityId: id,
      metadata: {
        fields: Object.keys(patch),
        approvalReset: wordingChanged && cur.approval !== 'DRAFT',
      },
    });
    return row;
  }

  async remove(companyId: string, id: string, actorIdentityId: string) {
    await this.get(companyId, id);
    const used = await this.prisma.commCampaign.count({
      where: {
        templateId: id,
        status: {
          in: [
            'PENDING_APPROVAL',
            'APPROVED',
            'SCHEDULED',
            'SENDING',
            'PAUSED',
          ],
        },
      },
    });
    if (used > 0)
      throw new ConflictException(
        'A campaign that has not finished uses this template.',
      );
    const anyUse = await this.prisma.commCampaign.count({
      where: { templateId: id },
    });
    if (anyUse > 0) {
      await this.prisma.commTemplate.update({
        where: { id },
        data: { isActive: false },
      });
    } else {
      await this.prisma.commTemplate.delete({ where: { id } });
    }
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.template_removed',
      entityType: 'CommTemplate',
      entityId: id,
      metadata: { retired: anyUse > 0 },
    });
    return { removed: true, retired: anyUse > 0 };
  }

  /** What a message made from this template looks like, with obviously fake sample values. */
  async preview(
    companyId: string,
    id: string,
    values: Record<string, string> = {},
  ) {
    const t = await this.get(companyId, id);
    const merged = { ...SAMPLE_VALUES, ...values };
    if (t.channel === 'EMAIL') {
      const e = buildEmail({
        subject: t.subject ?? '',
        bodyHtml: t.bodyHtml,
        bodyText: t.bodyText,
        values: merged,
        unsubscribeUrl: 'https://example.invalid/unsubscribe/sample',
        preferencesUrl: 'https://example.invalid/preferences/sample',
        senderName: merged.company_name,
        marketing: t.category === 'MARKETING',
      });
      return {
        channel: t.channel,
        subject: e.subject,
        html: e.html,
        text: e.text,
        sample: true,
      };
    }
    const r = renderText(t.bodyText, merged);
    return { channel: t.channel, text: r.text, sample: true };
  }

  // ---------------------------------------------------------------------------------------------- WhatsApp approval

  /**
   * Reads the review state of templates from the provider and updates the local records. In the simulator there is
   * nothing to read, and the result says so.
   */
  async syncWhatsApp(companyId: string, actorIdentityId: string) {
    const provider = await this.whatsapp.activeProviderName();
    if (provider === 'mock')
      return {
        provider,
        synced: 0,
        note: 'The simulator has no template review. Approval below is only a local label.',
      };
    const remote = await this.outbound.listWhatsAppTemplates();
    const local = await this.prisma.commTemplate.findMany({
      where: {
        companyId,
        channel: 'WHATSAPP',
        whatsappTemplateName: { not: null },
      },
    });
    let synced = 0;
    for (const t of local) {
      const match = remote.find(
        (r) => r.name === t.whatsappTemplateName && r.language === t.language,
      );
      if (!match) continue;
      const approval =
        (
          {
            APPROVED: 'APPROVED',
            PENDING: 'PENDING',
            REJECTED: 'REJECTED',
            PAUSED: 'PAUSED',
            DISABLED: 'PAUSED',
          } as Record<string, CommTemplate['approval']>
        )[match.status] ?? 'PENDING';
      await this.prisma.commTemplate.update({
        where: { id: t.id },
        data: {
          approval,
          providerTemplateId: match.providerTemplateId ?? t.providerTemplateId,
          lastSyncedAt: new Date(),
        },
      });
      synced++;
    }
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.templates_synced',
      entityType: 'CommTemplate',
      metadata: { synced, remote: remote.length },
    });
    return {
      provider,
      synced,
      remote: remote.length,
      notFound: local.length - synced,
    };
  }

  /** The operator says they have submitted this template in Meta's template manager. */
  async markSubmitted(companyId: string, id: string, actorIdentityId: string) {
    const t = await this.get(companyId, id);
    if (t.channel !== 'WHATSAPP')
      throw new BadRequestException('Only WhatsApp templates need review.');
    if (t.approval !== 'DRAFT' && t.approval !== 'REJECTED')
      throw new BadRequestException('This template is not a draft.');
    const row = await this.prisma.commTemplate.update({
      where: { id },
      data: { approval: 'PENDING' },
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.template_marked_submitted',
      entityType: 'CommTemplate',
      entityId: id,
    });
    return row;
  }

  /** Simulator only: pretend the review passed, so campaigns can be tried end to end without Meta. Labelled as such. */
  async simulateApproval(
    companyId: string,
    id: string,
    actorIdentityId: string,
  ) {
    const provider = await this.whatsapp.activeProviderName();
    if (provider !== 'mock')
      throw new BadRequestException(
        'Approval comes from Meta when a real provider is selected. Use “Synchronise”.',
      );
    const t = await this.get(companyId, id);
    if (t.channel !== 'WHATSAPP')
      throw new BadRequestException('Only WhatsApp templates need review.');
    const row = await this.prisma.commTemplate.update({
      where: { id },
      data: { approval: 'APPROVED', lastSyncedAt: new Date() },
    });
    await this.audit.record({
      identityId: actorIdentityId,
      companyId,
      action: 'comm.template_approval_simulated',
      entityType: 'CommTemplate',
      entityId: id,
      metadata: { simulated: true },
    });
    return row;
  }
}
