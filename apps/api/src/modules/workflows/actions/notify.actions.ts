import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PERMISSIONS } from '../../rbac/constants/permissions.constant';
import { WhatsAppConversationsService } from '../../whatsapp/whatsapp-conversations.service';
import { ActionError } from '../engine/retry';
import {
  directionFor,
  Language,
  pickLanguage,
  SUPPORTED_LANGUAGES,
} from '../engine/template';
import { ActionContext, WorkflowAction } from './action.types';

type Channel = 'EMAIL' | 'SMS' | 'PUSH' | 'WHATSAPP';
interface Text {
  subject: string;
  body: string;
}

/** The customer, resolved inside the workflow's own company. Never trusts an id from the event alone. */
async function loadCustomer(prisma: PrismaService, ctx: ActionContext) {
  const raw = ctx.config.customerId;
  const id =
    typeof raw === 'string' && raw
      ? ctx.render(raw)
      : ((ctx.context.customer as { id?: unknown } | undefined)?.id as
          string | undefined);
  if (!id)
    throw new ActionError('No customer to message', 'PERMANENT', 'NO_CUSTOMER');
  const c = await prisma.customer.findFirst({
    where: { id, companyId: ctx.companyId },
    select: {
      id: true,
      preferredLanguage: true,
      identity: { select: { id: true, email: true, phone: true } },
    },
  });
  if (!c)
    throw new ActionError(
      'The customer does not belong to this company',
      'PERMANENT',
      'CROSS_TENANT',
    );
  return c;
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A subject is optional (SMS and WhatsApp have none); an absent one is an empty string, not a template error. */
const renderOptional = (ctx: ActionContext, v: unknown): string => {
  const s = asText(v);
  return s ? ctx.render(s) : '';
};

/** Either one `subject`/`body`, or `translations: { en|ha|ar: { subject, body } }` chosen by the customer's language. */
function chooseText(
  ctx: ActionContext,
  preferred: string | null | undefined,
): Text & { language: Language; direction: 'ltr' | 'rtl' } {
  const tr = ctx.config.translations as
    Record<string, Partial<Text>> | undefined;
  if (tr) {
    const available = SUPPORTED_LANGUAGES.filter((l) => tr[l]?.body);
    const language = pickLanguage(preferred, available);
    const t = tr[language];
    return {
      subject: renderOptional(ctx, t?.subject),
      body: ctx.render(asText(t?.body)),
      language,
      direction: directionFor(language),
    };
  }
  return {
    subject: renderOptional(ctx, ctx.config.subject),
    body: ctx.render(asText(ctx.config.body)),
    language: 'en',
    direction: 'ltr',
  };
}

function validateText(c: Record<string, unknown>, channel: Channel): string[] {
  const errors: string[] = [];
  const tr = c.translations as
    Record<string, { body?: unknown; subject?: unknown }> | undefined;
  if (tr !== undefined) {
    if (!tr || typeof tr !== 'object' || Object.keys(tr).length === 0)
      return ['translations must list at least one language'];
    for (const [lang, t] of Object.entries(tr)) {
      if (!(SUPPORTED_LANGUAGES as readonly string[]).includes(lang))
        errors.push(`unsupported language "${lang}" (use en, ha or ar)`);
      else if (!t || typeof t.body !== 'string' || !t.body)
        errors.push(`translations.${lang}.body is required`);
      else if (
        (channel === 'EMAIL' || channel === 'PUSH') &&
        typeof t.subject !== 'string'
      )
        errors.push(
          `translations.${lang}.subject is required for ${channel.toLowerCase()}`,
        );
    }
    if (!tr.en)
      errors.push('an English (en) version is required as the fallback');
  } else {
    if (typeof c.body !== 'string' || !c.body) errors.push('body is required');
    if (
      (channel === 'EMAIL' || channel === 'PUSH') &&
      (typeof c.subject !== 'string' || !c.subject)
    )
      errors.push('subject is required');
  }
  return errors;
}

/** E-mail, SMS and push to a CUSTOMER of the workflow's company. Idempotent, honours preferences and opt-outs. */
@Injectable()
export class NotifyAction implements WorkflowAction {
  readonly sideEffect = 'NOTIFY' as const;
  readonly requiredPermissions = [PERMISSIONS.WORKFLOW.SEND_MESSAGES];
  readonly key: string;
  readonly label: string;

  constructor(
    private readonly channel: Exclude<Channel, 'WHATSAPP'>,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    this.key = `notify.${channel.toLowerCase()}`;
    this.label = `Send ${channel === 'EMAIL' ? 'an email' : channel === 'SMS' ? 'an SMS' : 'a push notification'}`;
  }

  validate(c: Record<string, unknown>): string[] {
    return validateText(c, this.channel);
  }

  async run(ctx: ActionContext) {
    const customer = await loadCustomer(this.prisma, ctx);
    const text = chooseText(ctx, customer.preferredLanguage);
    const res = await this.notifications.sendWorkflowMessage({
      channel: this.channel,
      to:
        this.channel === 'EMAIL'
          ? customer.identity.email
          : customer.identity.phone,
      identityId: customer.identity.id,
      subject: text.subject,
      body: text.body,
      idempotencyKey: ctx.idempotencyKey,
      data:
        this.channel === 'PUSH' && typeof ctx.config.deepLink === 'string'
          ? { deepLink: ctx.render(ctx.config.deepLink) }
          : undefined,
    });
    // A provider failure is worth retrying; "no recipient" / "opted out" is a normal outcome, not an error.
    if (
      !res.sent &&
      res.reason &&
      ![
        'already_sent',
        'no_recipient',
        'blocked_by_preferences_or_unreachable',
      ].includes(res.reason)
    ) {
      throw new ActionError(
        `${this.channel} not sent: ${res.reason}`,
        'RETRYABLE',
        'PROVIDER_FAILED',
      );
    }
    return {
      sent: res.sent,
      reason: res.reason ?? null,
      language: text.language,
      direction: text.direction,
    };
  }

  mock(ctx: ActionContext) {
    const hint = ctx.context.customer as
      { preferredLanguage?: string } | undefined;
    const text = chooseText(ctx, hint?.preferredLanguage);
    return {
      wouldSend: this.channel,
      subject: text.subject,
      body: text.body,
      language: text.language,
      direction: text.direction,
      mocked: true,
    };
  }
}

/**
 * WhatsApp via the existing WhatsApp module (consent, opt-out, conversation records, its own
 * idempotency key) — not a second WhatsApp pipeline. Always passes the customer id so the
 * module's opt-in check applies.
 */
@Injectable()
export class WhatsAppNotifyAction implements WorkflowAction {
  key = 'notify.whatsapp';
  label = 'Send a WhatsApp message';
  sideEffect = 'NOTIFY' as const;
  requiredPermissions = [PERMISSIONS.WHATSAPP.SEND];

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppConversationsService,
  ) {}

  validate(c: Record<string, unknown>): string[] {
    return validateText(c, 'WHATSAPP');
  }

  async run(ctx: ActionContext) {
    const customer = await loadCustomer(this.prisma, ctx);
    if (!customer.identity.phone)
      return { sent: false, reason: 'no_recipient' };
    const text = chooseText(ctx, customer.preferredLanguage);
    const res = await this.whatsapp.sendAutomatedMessage(
      ctx.companyId,
      customer.identity.phone,
      text.body,
      ctx.idempotencyKey,
      customer.id,
    );
    if (!res.sent && res.reason && /fail|error|timeout/i.test(res.reason)) {
      throw new ActionError(
        `WhatsApp not sent: ${res.reason}`,
        'RETRYABLE',
        'PROVIDER_FAILED',
      );
    }
    return {
      sent: res.sent,
      reason: res.reason ?? null,
      language: text.language,
      direction: text.direction,
    };
  }

  mock(ctx: ActionContext) {
    const hint = ctx.context.customer as
      { preferredLanguage?: string } | undefined;
    const text = chooseText(ctx, hint?.preferredLanguage);
    return {
      wouldSend: 'WHATSAPP',
      body: text.body,
      language: text.language,
      direction: text.direction,
      mocked: true,
    };
  }
}
