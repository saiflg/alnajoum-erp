import { BadRequestException } from '@nestjs/common';
import { CommTemplateCategory } from '@prisma/client';

/** Values any template may use. Nothing here is more personal than a first name. */
export const COMMON_VARIABLES = [
  'first_name',
  'name',
  'company_name',
  'offer',
  'package_name',
  'price',
  'destination',
  'departure_date',
  'valid_until',
  'link',
  'contact_phone',
  'message',
] as const;

/** Values only a service message about the person's own booking, payment or documents may use. */
export const TRANSACTIONAL_VARIABLES = [
  'booking_ref',
  'amount',
  'due_date',
  'status',
  'document_name',
] as const;

export const UNSUBSCRIBE_VARIABLES = [
  'unsubscribe_link',
  'preferences_link',
] as const;

export function allowedVariables(
  category: CommTemplateCategory,
  channel: 'EMAIL' | 'WHATSAPP',
): string[] {
  const base: string[] = [...COMMON_VARIABLES];
  // A marketing message never carries booking or payment details, whatever the author types.
  if (category !== 'MARKETING') base.push(...TRANSACTIONAL_VARIABLES);
  if (channel === 'EMAIL') base.push(...UNSUBSCRIBE_VARIABLES);
  return base;
}

const VAR = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

/** Variable names in the order they first appear. */
export function extractVariables(
  ...texts: (string | null | undefined)[]
): string[] {
  const seen: string[] = [];
  for (const t of texts)
    for (const m of (t ?? '').matchAll(VAR)) {
      const name = m[1].toLowerCase();
      if (!seen.includes(name)) seen.push(name);
    }
  return seen;
}

export function assertVariablesAllowed(
  names: string[],
  category: CommTemplateCategory,
  channel: 'EMAIL' | 'WHATSAPP',
): void {
  const ok = new Set(allowedVariables(category, channel));
  const bad = names.filter((n) => !ok.has(n));
  if (bad.length)
    throw new BadRequestException(
      `These values cannot be used in a ${category.toLowerCase()} ${channel === 'EMAIL' ? 'email' : 'WhatsApp'} template: ${bad.join(', ')}.`,
    );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fills {{name}} markers. A marker with no value is reported, never left in the text or filled with a guess. */
export function renderText(
  text: string,
  values: Record<string, string>,
  opts: { html?: boolean } = {},
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(VAR, (_m, raw: string) => {
    const name = raw.toLowerCase();
    const v = values[name];
    if (v === undefined || v === '') {
      if (!missing.includes(name)) missing.push(name);
      return '';
    }
    return opts.html ? escapeHtml(v) : v;
  });
  return { text: out, missing };
}

// ------------------------------------------------------------------------------------------------ HTML safety

const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'head',
  'title',
]);
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  'h1',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'div',
  'span',
  'hr',
  'blockquote',
  'center',
]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align']),
  table: new Set(['width', 'align', 'cellpadding', 'cellspacing']),
  p: new Set(['align']),
  div: new Set(['align']),
  span: new Set([]),
};

function safeUrl(value: string, kind: 'href' | 'src'): string | null {
  // Browsers ignore tabs, newlines and other control characters inside a URL scheme ("java\tscript:"), so drop them.
  const v = [...value.trim()]
    .filter(
      (ch) =>
        ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f && !/\s/.test(ch),
    )
    .join('');
  if (kind === 'src') return /^https:\/\//i.test(v) ? value.trim() : null;
  // Template markers such as {{link}} are filled later, from values the system controls.
  if (/^\{\{[a-z_]+\}\}$/i.test(v)) return value.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(v) ? value.trim() : null;
}

/**
 * Keeps a small set of formatting tags and a few attributes; everything else (scripts, forms, frames, inline event
 * handlers, javascript: and data: links, style and class attributes) is removed. Used for every campaign and template
 * body, so a pasted or imported design cannot carry active content into someone's inbox.
 */
export function sanitizeHtml(input: string): string {
  let html = input.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_WITH_CONTENT)
    html = html
      .replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
      .replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '');
  return html.replace(
    /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi,
    (_m, close: string, rawName: string, attrs: string) => {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return '';
      if (close) return `</${name}>`;
      const allowed = ALLOWED_ATTRS[name] ?? new Set<string>();
      const kept: string[] = [];
      for (const a of attrs.matchAll(
        /([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
      )) {
        const attr = a[1].toLowerCase();
        const value = a[2] ?? a[3] ?? a[4] ?? '';
        if (!allowed.has(attr)) continue;
        if (attr === 'href' || attr === 'src') {
          const safe = safeUrl(value, attr);
          if (safe)
            kept.push(`${attr}="${escapeHtml(safe).replace(/&amp;/g, '&')}"`);
          continue;
        }
        kept.push(`${attr}="${escapeHtml(value)}"`);
      }
      const selfClose = name === 'br' || name === 'hr' || name === 'img';
      return `<${name}${kept.length ? ` ${kept.join(' ')}` : ''}${selfClose ? ' /' : ''}>`;
    },
  );
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-4]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(
      /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, label: string) => {
        const l = label.replace(/<[^>]+>/g, '').trim();
        return l && l !== href ? `${l} (${href})` : href;
      },
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  missing: string[];
}

/**
 * Builds the final email. The footer with the sender's name, the unsubscribe link and the preferences link is added
 * here, always, and cannot be removed by editing a template.
 */
export function buildEmail(p: {
  subject: string;
  bodyHtml: string | null;
  bodyText: string;
  values: Record<string, string>;
  unsubscribeUrl: string;
  preferencesUrl: string;
  senderName: string;
  marketing: boolean;
}): RenderedEmail {
  const values = {
    ...p.values,
    unsubscribe_link: p.unsubscribeUrl,
    preferences_link: p.preferencesUrl,
  };
  const subject = renderText(p.subject.replace(/[\r\n]+/g, ' '), values);
  const bodyHtml = p.bodyHtml
    ? renderText(sanitizeHtml(p.bodyHtml), values, { html: true })
    : {
        text: escapeHtml(renderText(p.bodyText, values).text).replace(
          /\n/g,
          '<br />',
        ),
        missing: renderText(p.bodyText, values).missing,
      };
  const footerHtml = p.marketing
    ? `<hr /><p><small>You are receiving this because you chose to hear from ${escapeHtml(p.senderName)}. ` +
      `<a href="${escapeHtml(p.unsubscribeUrl)}">Unsubscribe</a> · <a href="${escapeHtml(p.preferencesUrl)}">Manage preferences</a></small></p>`
    : `<hr /><p><small>This is a service message from ${escapeHtml(p.senderName)} about your own booking or account.</small></p>`;
  const html = `${bodyHtml.text}${footerHtml}`;
  const bodyPlain = p.bodyHtml
    ? htmlToText(bodyHtml.text)
    : renderText(p.bodyText, values).text;
  const footerText = p.marketing
    ? `\n\n--\nYou are receiving this because you chose to hear from ${p.senderName}.\nUnsubscribe: ${p.unsubscribeUrl}\nManage preferences: ${p.preferencesUrl}`
    : `\n\n--\nThis is a service message from ${p.senderName} about your own booking or account.`;
  return {
    subject: subject.text,
    html,
    text: `${bodyPlain}${footerText}`,
    missing: [...new Set([...subject.missing, ...bodyHtml.missing])],
  };
}
