/**
 * Phase 21 — communication templates.
 *
 * A template is plain text with `{{variable.path}}` placeholders and nothing
 * else: no expressions, no filters, no helpers, no loops, no calls. A placeholder
 * is looked up in a context object by the same safe dotted-path rule the
 * condition language uses, so a template cannot reach a prototype member, run
 * code, or print an object graph. That removes the whole "template injection"
 * class by construction rather than by escaping.
 *
 * Rendering is strict by default: an unknown variable is an error naming the
 * variable, never a silent blank in a customer's message. HTML output escapes
 * every substituted value (the template author's own markup is left alone).
 */
import { fieldAllowed, isSafePath, readPath } from './conditions';

export const SUPPORTED_LANGUAGES = ['en', 'ha', 'ar'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly missing: string[] = [],
  ) {
    super(message);
  }
}

export const TEMPLATE_LIMITS = {
  maxTemplateLength: 5000,
  maxOutputLength: 10000,
  maxVariables: 50,
} as const;

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

/** Every variable a template uses, in order of first appearance. Throws on a malformed placeholder. */
export function extractVariables(template: string): string[] {
  const found: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1].trim();
    if (!isSafePath(name)) {
      throw new TemplateError(
        `"{{${match[1]}}}" is not a valid variable — use a plain path like customer.name`,
      );
    }
    if (!found.includes(name)) found.push(name);
  }
  // Anything left over once valid placeholders are removed must not contain a stray brace pair.
  const rest = template.replace(PLACEHOLDER, '');
  if (rest.includes('{{') || rest.includes('}}')) {
    throw new TemplateError(
      'The template has an unclosed or nested {{ }} placeholder',
    );
  }
  return found;
}

export interface TemplateIssue {
  message: string;
}

/** Author-time check: well-formed, within limits, and (optionally) only using variables the trigger provides. */
export function validateTemplate(
  template: string,
  allowedVariables?: ReadonlySet<string>,
): TemplateIssue[] {
  if (typeof template !== 'string' || template.trim().length === 0)
    return [{ message: 'The template is empty' }];
  if (template.length > TEMPLATE_LIMITS.maxTemplateLength) {
    return [
      {
        message: `The template is longer than ${TEMPLATE_LIMITS.maxTemplateLength} characters`,
      },
    ];
  }
  let vars: string[];
  try {
    vars = extractVariables(template);
  } catch (e) {
    return [{ message: e instanceof Error ? e.message : 'Invalid template' }];
  }
  const issues: TemplateIssue[] = [];
  if (vars.length > TEMPLATE_LIMITS.maxVariables)
    issues.push({
      message: `A template may use at most ${TEMPLATE_LIMITS.maxVariables} variables`,
    });
  if (allowedVariables) {
    for (const v of vars)
      if (!fieldAllowed(v, allowedVariables))
        issues.push({
          message: `Variable "${v}" is not available for this trigger`,
        });
  }
  return issues;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

function stringify(value: unknown, name: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  throw new TemplateError(
    `Variable "${name}" is not a simple value (text, number, true/false or date) and cannot be printed`,
    [name],
  );
}

export interface RenderOptions {
  /** `html` escapes substituted values; `text` (default) inserts them as they are. */
  format?: 'text' | 'html';
  /** `error` (default) rejects unknown variables; `blank` substitutes an empty string (for previews only). */
  onMissing?: 'error' | 'blank';
}

export function renderTemplate(
  template: string,
  context: unknown,
  opts: RenderOptions = {},
): string {
  const issues = validateTemplate(template);
  if (issues.length > 0) throw new TemplateError(issues[0].message);

  const missing: string[] = [];
  const out = template.replace(PLACEHOLDER, (_m, raw: string) => {
    const name = raw.trim();
    const value = readPath(context, name);
    if (value === undefined || value === null) {
      if ((opts.onMissing ?? 'error') === 'blank') return '';
      if (!missing.includes(name)) missing.push(name);
      return '';
    }
    const text = stringify(value, name);
    return opts.format === 'html' ? escapeHtml(text) : text;
  });

  if (missing.length > 0)
    throw new TemplateError(
      `Missing template variable(s): ${missing.join(', ')}`,
      missing,
    );
  if (out.length > TEMPLATE_LIMITS.maxOutputLength)
    throw new TemplateError(
      `The rendered message is longer than ${TEMPLATE_LIMITS.maxOutputLength} characters`,
    );
  return out;
}

export function isSupportedLanguage(v: unknown): v is Language {
  return (
    typeof v === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(v)
  );
}

/** Arabic reads right-to-left; everything else here is left-to-right. */
export function directionFor(language: Language): 'rtl' | 'ltr' {
  return language === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Choose the language to send in: the customer's preference if a template exists in it,
 * otherwise the fallback (English by default) — never an untranslated guess.
 */
export function pickLanguage(
  preferred: unknown,
  available: readonly Language[],
  fallback: Language = 'en',
): Language {
  if (isSupportedLanguage(preferred) && available.includes(preferred))
    return preferred;
  if (available.includes(fallback)) return fallback;
  return available[0] ?? fallback;
}
