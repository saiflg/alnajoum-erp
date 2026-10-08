/**
 * Pure safety helpers for the agent runtime. Nothing here talks to the database.
 *
 * The runtime never relies on a model "behaving": permissions, tenant scope and approval are enforced in code
 * around it. These helpers add detection (so attempts are visible), masking (so secrets are not sent to a model
 * or stored in traces) and output filtering (so a tool never hands back a field that must not leave the server).
 */

export type InjectionKind =
  | 'OVERRIDE_INSTRUCTIONS'
  | 'ROLE_ESCALATION'
  | 'FINANCIAL_BYPASS'
  | 'SECRET_REQUEST'
  | 'TENANT_ESCAPE'
  | 'ACTION_COMMAND';

interface Rule {
  kind: InjectionKind;
  re: RegExp;
}

// English, Hausa and Arabic phrasing for the attempts the red-team suite checks. Detection is a signal for the
// safety dashboard and for refusing blatant attempts; it is not the security boundary.
const RULES: Rule[] = [
  {
    kind: 'OVERRIDE_INSTRUCTIONS',
    re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|above|prior|your|all|system|safety)\b[^.\n]{0,30}\b(instructions?|rules?|prompt|polic(?:y|ies)|guidelines?|restrictions?)\b/i,
  },
  {
    kind: 'OVERRIDE_INSTRUCTIONS',
    re: /\b(you are now|from now on you|act as|pretend (?:to be|you are)|developer mode|jailbreak|\bDAN\b)\b/i,
  },
  {
    kind: 'OVERRIDE_INSTRUCTIONS',
    re: /(?:yi watsi da|manta da)\s+(?:umarnin|dokokin)|تجاهل\s+(?:كل\s+)?(?:التعليمات|القواعد|الأوامر)/i,
  },
  {
    kind: 'ROLE_ESCALATION',
    re: /\b(give|grant|make)\b[^.\n]{0,25}\b(me|us)\b[^.\n]{0,25}\b(admin|administrator|super ?admin|root|full access|all permissions?)\b/i,
  },
  {
    kind: 'ROLE_ESCALATION',
    re: /\b(i am|i'm|this is)\b[^.\n]{0,20}\b(the )?(admin|administrator|ceo|owner|developer|system)\b/i,
  },
  {
    kind: 'FINANCIAL_BYPASS',
    re: /\b(mark|set|flag|confirm)\b[^.\n]{0,30}\b(payment|invoice|transaction)\b[^.\n]{0,30}\b(as )?(verified|paid|successful|received|approved)\b/i,
  },
  {
    kind: 'FINANCIAL_BYPASS',
    re: /\b(mark|set|flag|record|treat)\b[^.\n]{0,20}\b(it|this|that|my|the|invoice|payment)\b[^.\n]{0,15}\b(as )?(paid|verified|successful|received|settled)\b/i,
  },
  {
    kind: 'FINANCIAL_BYPASS',
    re: /\b(skip|without|no need for|bypass)\b[^.\n]{0,20}\b(approval|verification|payment|review)\b/i,
  },
  {
    kind: 'FINANCIAL_BYPASS',
    re: /\b(refund|credit|add)\b[^.\n]{0,30}\b(my|the|this)\b[^.\n]{0,15}\b(wallet|account)\b[^.\n]{0,20}\b(now|immediately|without)\b/i,
  },
  {
    kind: 'SECRET_REQUEST',
    re: /\b(show|tell|give|print|reveal|display|leak|share|what(?:'s| is)|send)\b[^.\n]{0,40}\b(api[ _-]?keys?|secrets?|passwords?|tokens?|credentials?|system prompt|private key|env(?:ironment)? variables?|connection string|database url)\b/i,
  },
  {
    kind: 'SECRET_REQUEST',
    re: /\b(your|the)\b[^.\n]{0,15}\b(system prompt|instructions|hidden prompt|initial prompt)\b/i,
  },
  {
    kind: 'TENANT_ESCAPE',
    re: /\b(other|another|different|all)\b[^.\n]{0,20}\b(compan(?:y|ies)|tenants?|agenc(?:y|ies)|branch(?:es)?|organi[sz]ations?)\b[^.\n]{0,30}\b(customers?|bookings?|data|records?|invoices?|staff|clients?)\b/i,
  },
  {
    kind: 'TENANT_ESCAPE',
    re: /\b(customers?|bookings?|data|records?)\b[^.\n]{0,25}\b(of|from|at|for)\b[^.\n]{0,15}\b(another|other|a different)\b[^.\n]{0,12}\b(compan(?:y|ies)|agency|tenant|branch)\b/i,
  },
  {
    kind: 'ACTION_COMMAND',
    re: /\b(issue|release|execute|run|approve|process)\b[^.\n]{0,25}\b(this |the |my )?(ticket|refund|payout|payment|transfer|booking)\b[^.\n]{0,25}\b(now|immediately|anyway|regardless)\b/i,
  },
  {
    kind: 'ACTION_COMMAND',
    re: /\b(ignore|disregard)\b[^.\n]{0,40}\b(and|then)\b[^.\n]{0,15}\b(issue|refund|approve|pay|transfer)\b/i,
  },
  {
    kind: 'ACTION_COMMAND',
    re: /\b(drop|delete|truncate)\b[^.\n]{0,15}\b(table|database|all (?:records|data|customers))\b|\bselect\b[^.\n]{1,60}\bfrom\b[^.\n]{1,40}\bwhere\b/i,
  },
];

export interface InjectionScan {
  flagged: boolean;
  kinds: InjectionKind[];
  /** Short excerpts, for the safety event. */
  matches: string[];
}

export function detectInjection(text: string): InjectionScan {
  const kinds = new Set<InjectionKind>();
  const matches: string[] = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) {
      kinds.add(rule.kind);
      matches.push(m[0].slice(0, 80));
    }
  }
  return { flagged: kinds.size > 0, kinds: [...kinds], matches };
}

/**
 * Whether the message should be refused outright, without asking the model. A message that tries to override
 * the rules, escalate privileges, bypass a financial control, extract a secret, reach another tenant's data or
 * run SQL is refused; ordinary text that merely resembles an instruction is not.
 */
export function shouldRefuse(scan: InjectionScan): boolean {
  return scan.flagged;
}

/**
 * Untrusted content (a customer message, a document, an email, a supplier or provider response) is data. It is
 * handed to a model inside an explicit envelope, with anything that looks like a control phrase defused, and the
 * model is told that nothing inside can change its rules. The envelope is a courtesy to the model; the real
 * boundary is that the content cannot add tools, permissions or approvals no matter what it says.
 */
export function wrapUntrusted(label: string, content: string): string {
  const safe = maskSensitive(content)
    .replace(/<\/?untrusted[^>]*>/gi, '[tag removed]')
    .slice(0, 6000);
  return `<untrusted source="${label}">\n${safe}\n</untrusted>`;
}

// --------------------------------------------------------------------------- masking

const luhn = (digits: string): boolean => {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
};

const MASK = '[REDACTED]';

/** Removes credentials and payment data from text before it goes to a model or into a stored trace. */
export function maskSensitive(text: string): string {
  let out = text;
  out = out.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    MASK,
  );
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    MASK,
  );
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${MASK}`);
  out = out.replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, MASK);
  out = out.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, MASK);
  out = out.replace(/\benc:v1:[A-Za-z0-9_:-]+/g, MASK);
  out = out.replace(
    /\b(password|passwd|pwd|secret|api[_-]?key|token|authorization|cvv|cvc|pin)\b(\s*[:=]\s*|\s+is\s+)(["']?)[^\s"',;]{3,}\3/gi,
    (_m, k: string, sep: string) => `${k}${sep}${MASK}`,
  );
  // Card numbers: 13-19 digits (spaces/dashes allowed) that pass the Luhn check.
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/[^\d]/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits)
      ? MASK
      : m;
  });
  return out;
}

/** Applies maskSensitive to every string in a JSON-like value. */
export function maskDeep<T>(value: T): T {
  if (typeof value === 'string') return maskSensitive(value) as unknown as T;
  if (Array.isArray(value)) return value.map(maskDeep) as unknown as T;
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      o[k] = maskDeep(v);
    }
    return o as T;
  }
  return value;
}

// --------------------------------------------------------------------------- output filtering

/** Field names that never leave the server through an agent, whatever the tool returned. */
const FORBIDDEN_KEYS = new Set([
  'passwordhash',
  'twofactorsecret',
  'twofactorlaststep',
  'tokenhash',
  'codehash',
  'refreshtoken',
  'accesstoken',
  'bankaccountnumber',
  'internalcost',
  'costprice',
  'incentiverule',
  'apikey',
  'secret',
  'webhooksecret',
  'privatekey',
  'config',
]);

const PARTIAL_KEYS = new Set(['passportnumber', 'nin', 'bvn', 'idnumber']);

const partial = (v: unknown): unknown => {
  const s = String(v ?? '');
  return s.length <= 3 ? '***' : `${'*'.repeat(s.length - 3)}${s.slice(-3)}`;
};

/**
 * Removes forbidden fields, masks identity numbers down to their last characters, and masks credentials found in
 * remaining strings. Applied to every tool output before the model, the trace or the user sees it.
 */
export function filterOutput<T>(value: T): T {
  if (Array.isArray(value)) return value.map(filterOutput) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (FORBIDDEN_KEYS.has(lk)) continue;
      o[k] = PARTIAL_KEYS.has(lk) && v ? partial(v) : filterOutput(v);
    }
    return o as T;
  }
  if (typeof value === 'string') return maskSensitive(value) as unknown as T;
  return value;
}
