import { Injectable } from '@nestjs/common';
import { MessageTemplateChannel } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const DEFAULT_TEMPLATES: {
  key: string;
  name: string;
  channel: MessageTemplateChannel;
  subject?: string;
  body: string;
}[] = [
  {
    key: 'WELCOME_EMAIL',
    name: 'Welcome Email',
    channel: 'EMAIL',
    subject: 'Welcome to Alnajoum Travel Agency',
    body: 'Hello {{customer_name}},\n\nWelcome to Alnajoum Travel Agency. We are glad to have you with us.',
  },
  {
    key: 'BOOKING_CONFIRMATION',
    name: 'Booking Confirmation',
    channel: 'EMAIL',
    subject: 'Booking confirmed: {{reference}}',
    body: 'Hello {{customer_name}},\n\nYour {{service_type}} booking {{reference}} is confirmed.',
  },
  {
    key: 'PAYMENT_RECEIPT',
    name: 'Payment Receipt',
    channel: 'EMAIL',
    subject: 'Payment received: {{reference}}',
    body: 'Hello {{customer_name}},\n\nWe received your payment of {{amount}} against {{reference}}.',
  },
  {
    key: 'APPLICATION_UPDATE',
    name: 'Application Status Update',
    channel: 'EMAIL',
    subject: '{{service_type}} application {{application_number}} updated',
    body: 'Hello {{customer_name}},\n\nYour {{service_type}} application {{application_number}} has been updated to: {{status}}.',
  },
  {
    key: 'PAYMENT_REMINDER',
    name: 'Payment Reminder',
    channel: 'SMS',
    body: 'Hi {{customer_name}}, a payment of {{amount}} is due on {{due_date}} for {{reference}}. — Alnajoum Travel',
  },
  {
    key: 'SUPPORT_TICKET_UPDATE',
    name: 'Support Ticket Update',
    channel: 'WHATSAPP',
    body: 'Hi {{customer_name}}, there is an update on your support ticket {{reference}}: {{message}}',
  },
];

/**
 * Spec #22's template engine — {{variable}} substitution only, one regex
 * pass, every value HTML-escaped before insertion. There is no code path
 * from a template string to `eval`/`Function`/template-literal
 * interpolation anywhere in `render()`, which is what "prevent arbitrary
 * code execution through template variables" means in practice.
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaults(): Promise<void> {
    for (const def of DEFAULT_TEMPLATES) {
      await this.prisma.messageTemplate.upsert({
        where: { key: def.key },
        create: def,
        update: {},
      });
    }
  }

  listAll() {
    return this.prisma.messageTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  async get(key: string) {
    return this.prisma.messageTemplate.findUnique({ where: { key } });
  }

  update(
    key: string,
    data: {
      name?: string;
      subject?: string;
      body?: string;
      isActive?: boolean;
    },
  ) {
    return this.prisma.messageTemplate.update({ where: { key }, data });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** `{{var}}` → the corresponding value from `variables`, HTML-escaped; an unknown variable is left untouched rather than throwing, matching a template author's expectation of a literal preview. */
  render(template: string, variables: Record<string, string | number>): string {
    return template.replace(
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      (match, key: string) => {
        const value = variables[key];
        if (value === undefined) return match;
        return this.escapeHtml(String(value));
      },
    );
  }

  async renderByKey(key: string, variables: Record<string, string | number>) {
    const template = await this.get(key);
    if (!template || !template.isActive) return null;
    return {
      subject: template.subject
        ? this.render(template.subject, variables)
        : undefined,
      body: this.render(template.body, variables),
      channel: template.channel,
    };
  }
}
