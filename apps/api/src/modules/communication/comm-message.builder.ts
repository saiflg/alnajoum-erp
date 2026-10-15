import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstName, whatsAppParameter } from './comm-campaign.rules';
import { buildEmail } from './comm-render';

export interface BuiltEmail {
  channel: 'EMAIL';
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}
export interface BuiltWhatsApp {
  channel: 'WHATSAPP';
  templateName: string;
  language: string;
  variables: string[];
  /** The text people will see, for previews and reports only. */
  previewText: string;
}
export type BuiltMessage = (BuiltEmail | BuiltWhatsApp) & { missing: string[] };

export interface TemplateContent {
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string;
  variables: string[];
  whatsappTemplateName: string | null;
  language: string;
}

/**
 * Turns a template (or a campaign's own email text) and one person into the exact message to send. Used by
 * campaigns, test sends and service messages alike, so a preview is built by the same code as the real thing.
 */
@Injectable()
export class CommMessageBuilder {
  constructor(private readonly config: ConfigService) {}

  webOrigin(): string {
    return this.config.get<string>(
      'PUBLIC_WEB_ORIGIN',
      'http://localhost:3000',
    );
  }
  apiOrigin(): string {
    return this.config.get<string>(
      'PUBLIC_API_ORIGIN',
      'http://localhost:4000',
    );
  }

  links(preferenceToken: string, channel: 'EMAIL' | 'WHATSAPP') {
    return {
      unsubscribeUrl: `${this.webOrigin()}/unsubscribe/${preferenceToken}?channel=${channel}`,
      preferencesUrl: `${this.webOrigin()}/preferences/${preferenceToken}`,
      oneClickUrl: `${this.apiOrigin()}/api/v1/public/comm/unsubscribe/${preferenceToken}`,
    };
  }

  build(p: {
    channel: 'EMAIL' | 'WHATSAPP';
    marketing: boolean;
    content: TemplateContent;
    contact: { fullName: string; preferenceToken: string };
    values: Record<string, string>;
    senderName: string;
    contactPhone?: string | null;
  }): BuiltMessage {
    const perPerson: Record<string, string> = {
      first_name: firstName(p.contact.fullName),
      name: p.contact.fullName.trim(),
      company_name: p.senderName,
      ...(p.contactPhone ? { contact_phone: p.contactPhone } : {}),
    };
    const values = { ...p.values, ...perPerson };
    const links = this.links(p.contact.preferenceToken, p.channel);

    if (p.channel === 'EMAIL') {
      const e = buildEmail({
        subject: p.content.subject ?? '',
        bodyHtml: p.content.bodyHtml,
        bodyText: p.content.bodyText,
        values,
        unsubscribeUrl: links.unsubscribeUrl,
        preferencesUrl: links.preferencesUrl,
        senderName: p.senderName,
        marketing: p.marketing,
      });
      return {
        channel: 'EMAIL',
        subject: e.subject,
        html: e.html,
        text: e.text,
        // RFC 8058: lets mail programs offer a real "unsubscribe" button that works with one POST.
        headers: p.marketing
          ? {
              'List-Unsubscribe': `<${links.oneClickUrl}>, <${links.unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : {},
        missing: e.missing,
      };
    }

    const missing: string[] = [];
    const variables = p.content.variables.map((name) => {
      const v = values[name];
      if (v === undefined || v === '') {
        missing.push(name);
        return '';
      }
      return whatsAppParameter(v);
    });
    let previewText = p.content.bodyText;
    p.content.variables.forEach((name, i) => {
      previewText = previewText.replace(
        new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'gi'),
        variables[i],
      );
    });
    return {
      channel: 'WHATSAPP',
      templateName: p.content.whatsappTemplateName ?? '',
      language: p.content.language,
      variables,
      previewText,
      missing,
    };
  }
}
