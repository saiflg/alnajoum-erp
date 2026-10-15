import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommChannel } from '@prisma/client';
import { FieldCipher } from '../../common/security/field-cipher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  NOTIFICATION_PROVIDER,
  type NotificationProviderPort,
} from '../notifications/providers/notification-provider.port';
import { WhatsAppProviderRouter } from '../whatsapp/providers/whatsapp-provider.router';
import { CommConsentService } from './comm-consent.service';
import { CommContactsService } from './comm-contacts.service';
import {
  maskEmail,
  maskPhone,
  normaliseEmail,
  normalisePhone,
} from './comm-identifiers';
import { CommSettingsService } from './comm-settings.service';
import { CommTemplatesService } from './comm-templates.service';
import { PublicPreferencesDto, PublicSubscribeDto } from './dto/comm.dto';

export interface PublicRequestInfo {
  ip?: string;
  userAgent?: string;
}

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

/** Same answer whether the address was new, already known, already subscribed, or blocked: nothing is revealed. */
const SUBSCRIBE_ANSWER =
  'Thank you. If the details are valid we have sent a confirmation to each channel you chose. Nothing starts until you confirm.';

/**
 * The public side of consent: the subscription form, the confirmation link, the preference page and one-click
 * unsubscribe. Every route here is reachable without signing in, so each one reveals as little as possible,
 * takes only an unguessable token or a form the person submitted, and is rate limited at the controller.
 */
@Injectable()
export class CommPublicService {
  private readonly logger = new Logger(CommPublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: CommSettingsService,
    private readonly consent: CommConsentService,
    private readonly contacts: CommContactsService,
    private readonly templates: CommTemplatesService,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly email: NotificationProviderPort,
    private readonly whatsapp: WhatsAppProviderRouter,
  ) {}

  private origin(): string {
    return this.config.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
  }

  /**
   * The company a public form belongs to. One installation serves one agency in practice: it is the one named by
   * COMM_PUBLIC_COMPANY_ID, or the only active company. With several and no setting, the public forms are off.
   */
  async resolveCompanyId(): Promise<string> {
    const configured = this.config.get<string>('COMM_PUBLIC_COMPANY_ID');
    if (configured) {
      const c = await this.prisma.company.findFirst({
        where: { id: configured, isActive: true },
        select: { id: true },
      });
      if (c) return c.id;
      throw new NotFoundException();
    }
    const all = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 2,
    });
    if (all.length !== 1) throw new NotFoundException();
    return all[0].id;
  }

  async info() {
    const companyId = await this.resolveCompanyId();
    const [s, company] = await Promise.all([
      this.settings.get(companyId),
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, tradingName: true },
      }),
    ]);
    return {
      company: company?.tradingName ?? company?.name ?? '',
      topics: this.settings.topics(s),
      textVersion: s.consentTextVersion,
      consentTextWhatsApp: s.consentTextWhatsApp,
      consentTextEmail: s.consentTextEmail,
      privacyNoticeUrl: s.privacyNoticeUrl,
      doubleOptInEmail: s.doubleOptInEmail,
    };
  }

  private fingerprint(info: PublicRequestInfo): string | undefined {
    return info.ip
      ? FieldCipher.default().keyedHash(info.ip, 'comm-consent-ip')
      : undefined;
  }

  // ---------------------------------------------------------------------------------------------- subscribe

  async subscribe(dto: PublicSubscribeDto, req: PublicRequestInfo) {
    // A bot fills the hidden field; pretend it worked so it learns nothing.
    if (dto.website) return { received: true, message: SUBSCRIBE_ANSWER };

    const companyId = await this.resolveCompanyId();
    const s = await this.settings.get(companyId);
    const wantsWhatsApp = dto.whatsapp === true;
    const wantsEmail = dto.emailMarketing === true;
    if (!wantsWhatsApp && !wantsEmail)
      throw new BadRequestException(
        'Choose at least one way you would like to hear from us.',
      );
    if (dto.textVersion && dto.textVersion !== s.consentTextVersion)
      throw new ConflictException(
        'The wording on this page has been updated. Please reload the page and read it before subscribing.',
      );
    const phone = dto.phone ? normalisePhone(dto.phone) : null;
    const email = dto.email ? normaliseEmail(dto.email) : null;
    if (wantsWhatsApp && !phone)
      throw new BadRequestException('Enter a valid WhatsApp number.');
    if (wantsEmail && !email)
      throw new BadRequestException('Enter a valid email address.');

    const existing = await this.contacts.findByAddresses(
      companyId,
      wantsWhatsApp ? phone : null,
      wantsEmail ? email : null,
    );
    let contactId = existing[0]?.id;
    if (!contactId) {
      const created = await this.contacts.insert(companyId, {
        fullName: dto.fullName,
        phone: wantsWhatsApp ? phone : null,
        email: wantsEmail ? email : null,
        preferredLanguage: dto.language ?? 'en',
        source: 'WEBSITE_FORM',
        kind: 'SUBSCRIBER',
      });
      contactId = created.id;
    } else {
      // An existing contact may be missing the other channel's address; add it only when it is free.
      await this.attachMissingAddress(
        companyId,
        contactId,
        wantsWhatsApp ? phone : null,
        wantsEmail ? email : null,
      );
    }

    const evidence = {
      page: '/subscribe',
      ipFingerprint: this.fingerprint(req),
      userAgent: req.userAgent?.slice(0, 160),
    };
    const todo: { channel: CommChannel; text: string }[] = [];
    if (wantsWhatsApp)
      todo.push({ channel: 'WHATSAPP', text: s.consentTextWhatsApp });
    if (wantsEmail) todo.push({ channel: 'EMAIL', text: s.consentTextEmail });

    for (const t of todo) {
      try {
        const sub = await this.prisma.commSubscription.findUnique({
          where: { contactId_channel: { contactId, channel: t.channel } },
          select: { status: true, updatedAt: true },
        });
        if (sub?.status === 'SUBSCRIBED') continue;
        // Do not let the form be used to flood someone with confirmation messages.
        if (
          sub?.status === 'PENDING_CONFIRMATION' &&
          Date.now() - sub.updatedAt.getTime() < RESEND_COOLDOWN_MS
        )
          continue;
        const r = await this.consent.record({
          companyId,
          contactId,
          channel: t.channel,
          action: 'GRANTED',
          topics: dto.topics ?? [],
          source: 'WEBSITE_FORM',
          text: t.text,
          textVersion: s.consentTextVersion,
          evidence,
          // The form is typed by whoever has the keyboard, not necessarily the owner of the address: always confirm.
          doubleOptIn: true,
        });
        if (r.confirmToken)
          await this.sendConfirmation(
            companyId,
            contactId,
            t.channel,
            r.confirmToken,
          );
      } catch (e) {
        // Blocked addresses and send failures must look the same as success from the outside.
        this.logger.warn(
          `Subscribe ${t.channel} not completed: ${(e as Error).message}`,
        );
      }
    }
    return { received: true, message: SUBSCRIBE_ANSWER };
  }

  private async attachMissingAddress(
    companyId: string,
    contactId: string,
    phone: string | null,
    email: string | null,
  ): Promise<void> {
    for (const [type, value] of [
      ['PHONE', phone],
      ['EMAIL', email],
    ] as const) {
      if (!value) continue;
      const have = await this.prisma.commContactChannel.findFirst({
        where: { contactId, type },
        select: { id: true },
      });
      const taken = await this.prisma.commContactChannel.findFirst({
        where: { companyId, type, value },
        select: { id: true },
      });
      if (!have && !taken) {
        await this.prisma.commContactChannel.create({
          data: { contactId, companyId, type, value, isPrimary: true },
        });
        await this.prisma.commContact.update({
          where: { id: contactId },
          data:
            type === 'PHONE'
              ? { primaryPhone: value }
              : { primaryEmail: value },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- confirmation messages

  /** Sends the "please confirm" message. Returns whether a message actually left; callers never claim more. */
  async sendConfirmation(
    companyId: string,
    contactId: string,
    channel: CommChannel,
    token: string,
  ): Promise<{ sent: boolean; simulated?: boolean; reason?: string }> {
    const contact = await this.prisma.commContact.findFirst({
      where: { id: contactId, companyId },
      select: {
        primaryEmail: true,
        primaryPhone: true,
        fullName: true,
        preferenceToken: true,
        preferredLanguage: true,
      },
    });
    if (!contact) return { sent: false, reason: 'Contact not found' };
    const s = await this.settings.get(companyId);
    if (channel === 'EMAIL') {
      if (!contact.primaryEmail)
        return { sent: false, reason: 'No email address' };
      const link = `${this.origin()}/subscribe/confirm/${token}`;
      const unsub = `${this.origin()}/unsubscribe/${contact.preferenceToken}?channel=EMAIL`;
      const r = await this.email.sendEmail({
        to: contact.primaryEmail,
        subject: `Please confirm your subscription to ${s.senderName}`,
        textBody:
          `Hello ${contact.fullName.split(' ')[0]},\n\n` +
          `Someone asked for this email address to receive travel offers and updates from ${s.senderName}. ` +
          `If that was you, confirm here (the link works for 7 days):\n${link}\n\n` +
          `If it was not you, ignore this message and nothing will be sent.\n\n` +
          `You can opt out at any time: ${unsub}\n`,
      });
      return { sent: r.success, reason: r.error };
    }
    // WhatsApp: a business-initiated message needs an approved template.
    if (!contact.primaryPhone)
      return { sent: false, reason: 'No phone number' };
    await this.templates.ensureDefaults(companyId);
    const tpl = await this.prisma.commTemplate.findFirst({
      where: {
        companyId,
        channel: 'WHATSAPP',
        key: 'wa_optin_confirm',
        isActive: true,
      },
      orderBy: { language: 'asc' },
    });
    const language = contact.preferredLanguage;
    const chosen =
      (await this.prisma.commTemplate.findFirst({
        where: {
          companyId,
          channel: 'WHATSAPP',
          key: 'wa_optin_confirm',
          language,
          isActive: true,
        },
      })) ?? tpl;
    if (!chosen?.whatsappTemplateName)
      return {
        sent: false,
        reason: 'No WhatsApp confirmation template is configured',
      };
    const result = await this.whatsapp.sendTemplateMessage({
      to: contact.primaryPhone,
      templateName: chosen.whatsappTemplateName,
      languageCode: chosen.language,
      variables: [contact.fullName.split(' ')[0], s.senderName],
    });
    return { sent: result.success, reason: result.error };
  }

  // ---------------------------------------------------------------------------------------------- confirm

  confirm(token: string) {
    return this.consent.confirm(token);
  }

  // ---------------------------------------------------------------------------------------------- preferences

  private async byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new NotFoundException();
    const c = await this.prisma.commContact.findUnique({
      where: { preferenceToken: token },
      include: { subscriptions: true, channels: true },
    });
    if (!c || c.status !== 'ACTIVE') throw new NotFoundException();
    return c;
  }

  async preferences(token: string) {
    const c = await this.byToken(token);
    const s = await this.settings.get(c.companyId);
    const sub = (ch: CommChannel) =>
      c.subscriptions.find((x) => x.channel === ch);
    return {
      name: c.fullName.split(' ')[0],
      language: c.preferredLanguage,
      whatsapp: {
        address: c.primaryPhone ? maskPhone(c.primaryPhone) : null,
        status: sub('WHATSAPP')?.status ?? 'NONE',
      },
      email: {
        address: c.primaryEmail ? maskEmail(c.primaryEmail) : null,
        status: sub('EMAIL')?.status ?? 'NONE',
      },
      topics: this.settings.topics(s),
      chosenTopics: [...new Set(c.subscriptions.flatMap((x) => x.topics))],
      textVersion: s.consentTextVersion,
      consentTextWhatsApp: s.consentTextWhatsApp,
      consentTextEmail: s.consentTextEmail,
      privacyNoticeUrl: s.privacyNoticeUrl,
      note: 'Messages about your own bookings and payments are not marketing and are not affected by these choices.',
    };
  }

  /**
   * Turning a channel OFF is immediate. Turning one ON is a new consent and goes through confirmation again.
   * Changing topics on a channel that is already subscribed needs no new confirmation.
   */
  async updatePreferences(
    token: string,
    dto: PublicPreferencesDto,
    req: PublicRequestInfo,
  ) {
    const c = await this.byToken(token);
    const s = await this.settings.get(c.companyId);
    const evidence = {
      page: '/preferences',
      ipFingerprint: this.fingerprint(req),
    };
    if (dto.language)
      await this.prisma.commContact.update({
        where: { id: c.id },
        data: { preferredLanguage: dto.language },
      });

    const wants: [CommChannel, boolean | undefined, string][] = [
      ['WHATSAPP', dto.whatsapp, s.consentTextWhatsApp],
      ['EMAIL', dto.emailMarketing, s.consentTextEmail],
    ];
    for (const [channel, want, text] of wants) {
      if (want === undefined) continue;
      const current = c.subscriptions.find((x) => x.channel === channel);
      if (want === false) {
        if (
          current &&
          current.status !== 'UNSUBSCRIBED' &&
          current.status !== 'NONE'
        )
          await this.consent.record({
            companyId: c.companyId,
            contactId: c.id,
            channel,
            action: 'WITHDRAWN',
            source: 'PREFERENCE_PAGE',
            evidence,
          });
        continue;
      }
      if (current?.status === 'SUBSCRIBED') {
        if (dto.topics) {
          await this.prisma.commSubscription.update({
            where: { contactId_channel: { contactId: c.id, channel } },
            data: {
              topics: dto.topics.filter((t) =>
                this.settings.topics(s).some((x) => x.key === t),
              ),
            },
          });
        }
        continue;
      }
      if (
        current?.status === 'PENDING_CONFIRMATION' &&
        Date.now() - current.updatedAt.getTime() < RESEND_COOLDOWN_MS
      )
        continue;
      const r = await this.consent.record({
        companyId: c.companyId,
        contactId: c.id,
        channel,
        action: 'GRANTED',
        topics: dto.topics ?? [],
        source: 'PREFERENCE_PAGE',
        text,
        textVersion: s.consentTextVersion,
        evidence,
        doubleOptIn: true,
      });
      if (r.confirmToken)
        await this.sendConfirmation(c.companyId, c.id, channel, r.confirmToken);
    }
    return this.preferences(token);
  }

  /** One-click unsubscribe from the link in a message, for one channel or all. Idempotent. */
  async unsubscribe(
    token: string,
    channel: CommChannel | 'ALL',
    req: PublicRequestInfo,
    source = 'EMAIL_LINK',
  ) {
    const c = await this.byToken(token);
    const channels: CommChannel[] =
      channel === 'ALL' ? ['WHATSAPP', 'EMAIL'] : [channel];
    for (const ch of channels) {
      const current = c.subscriptions.find((x) => x.channel === ch);
      // Suppress even when nothing was subscribed: the person asked not to be marketed to on this channel.
      if (current?.status === 'UNSUBSCRIBED') continue;
      const hasAddress = c.channels.some(
        (x) => x.type === (ch === 'EMAIL' ? 'EMAIL' : 'PHONE'),
      );
      if (!hasAddress) continue;
      await this.consent.record({
        companyId: c.companyId,
        contactId: c.id,
        channel: ch,
        action: 'WITHDRAWN',
        source,
        evidence: { ipFingerprint: this.fingerprint(req) },
      });
    }
    return {
      unsubscribed: channels,
      message:
        'You have been unsubscribed. You will still receive messages about your own bookings and payments.',
    };
  }
}
