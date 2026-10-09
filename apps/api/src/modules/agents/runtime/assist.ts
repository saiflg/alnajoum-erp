import { classifySupport } from './support-classifier';

/**
 * Pure helpers for the document, email and call assistants. Everything they return is a PROPOSAL for a person
 * to check: nothing here writes to a customer record, sends a message or acts on a call.
 */

// ------------------------------------------------------------------------------------------ documents
export type ProposedDocumentType =
  | 'PASSPORT'
  | 'NATIONAL_ID'
  | 'VISA'
  | 'PHOTO'
  | 'VACCINATION_CERTIFICATE'
  | 'BIRTH_CERTIFICATE'
  | 'BANK_STATEMENT'
  | 'INVITATION_LETTER'
  | 'HOTEL_BOOKING'
  | 'FLIGHT_ITINERARY'
  | 'TRAVEL_INSURANCE'
  | 'OTHER';

const DOC_RULES: [ProposedDocumentType, RegExp][] = [
  ['PASSPORT', /passport|mrz|p<[a-z]{3}/i],
  ['VISA', /\bvisa\b/i],
  ['VACCINATION_CERTIFICATE', /vaccin|yellow\s?card|immuni[sz]ation/i],
  ['BIRTH_CERTIFICATE', /birth\s?cert/i],
  ['NATIONAL_ID', /national\s?id|\bnin\b|identity card/i],
  ['BANK_STATEMENT', /bank\s?statement|account statement/i],
  ['INVITATION_LETTER', /invitation/i],
  ['HOTEL_BOOKING', /hotel|reservation voucher/i],
  ['FLIGHT_ITINERARY', /itinerary|e-?ticket|boarding/i],
  ['TRAVEL_INSURANCE', /insurance/i],
  ['PHOTO', /\b(photo|passport[-_ ]?photo|selfie)\b|\.(jpe?g|png)$/i],
];

export interface DocumentProposal {
  proposedType: ProposedDocumentType;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  basis: string;
  requiresReview: true;
}

export function classifyDocument(
  fileName: string,
  textHint = '',
): DocumentProposal {
  const hay = `${fileName} ${textHint.slice(0, 2000)}`;
  const named = DOC_RULES.find(([t, re]) => t !== 'PHOTO' && re.test(fileName));
  if (named)
    return {
      proposedType: named[0],
      confidence: 'HIGH',
      basis: 'file name',
      requiresReview: true,
    };
  const content = DOC_RULES.find(([t, re]) => t !== 'PHOTO' && re.test(hay));
  if (content)
    return {
      proposedType: content[0],
      confidence: 'MEDIUM',
      basis: 'text in the document',
      requiresReview: true,
    };
  const photo = DOC_RULES.find(
    ([t, re]) => t === 'PHOTO' && (re.test(fileName) || re.test(hay)),
  );
  if (photo)
    return {
      proposedType: 'PHOTO',
      confidence: 'LOW',
      basis: 'image file name only',
      requiresReview: true,
    };
  return {
    proposedType: 'OTHER',
    confidence: 'LOW',
    basis: 'nothing recognisable',
    requiresReview: true,
  };
}

export interface PassportProposal {
  passportNumber?: string;
  expiryDate?: string;
  dateOfBirth?: string;
  surname?: string;
  givenNames?: string;
  issues: string[];
  /** Fields that would CHANGE an existing record: they always need an explicit human confirmation. */
  conflicts: { field: string; existing: string | null; proposed: string }[];
  requiresReview: true;
}

const iso = (
  yy: string,
  mm: string,
  dd: string,
  future: boolean,
  now: Date,
): string => {
  const y = Number(yy);
  const century = Math.floor(now.getUTCFullYear() / 100) * 100;
  let year = century + y;
  if (future ? year < now.getUTCFullYear() - 5 : year > now.getUTCFullYear())
    year += future ? 100 : -100;
  return `${year}-${mm}-${dd}`;
};

/**
 * Reads OCR/MRZ text into proposed passport fields and validates them (format, check digits, dates). It never
 * overwrites anything: differences from the stored record are returned as conflicts for a person to decide.
 */
export function extractPassport(
  text: string,
  existing: {
    passportNumber?: string | null;
    passportExpiryDate?: string | null;
  } = {},
  now = new Date(),
): PassportProposal {
  const out: PassportProposal = {
    issues: [],
    conflicts: [],
    requiresReview: true,
  };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, '').toUpperCase())
    .filter((l) => l.length >= 30);
  const mrz2 = lines.find(
    (l, i) =>
      i > 0 &&
      /^[A-Z0-9<]{9}[0-9][A-Z<]{3}[0-9]{6}[0-9][MF<][0-9]{6}[0-9]/.test(l),
  );
  if (mrz2) {
    out.passportNumber = mrz2.slice(0, 9).replace(/</g, '');
    out.dateOfBirth = iso(
      mrz2.slice(13, 15),
      mrz2.slice(15, 17),
      mrz2.slice(17, 19),
      false,
      now,
    );
    out.expiryDate = iso(
      mrz2.slice(21, 23),
      mrz2.slice(23, 25),
      mrz2.slice(25, 27),
      true,
      now,
    );
    const check = (s: string) => {
      const w = [7, 3, 1];
      let sum = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        const v =
          c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
        sum += v * w[i % 3];
      }
      return sum % 10;
    };
    if (check(mrz2.slice(0, 9)) !== Number(mrz2[9]))
      out.issues.push(
        'The passport-number check digit does not match: the scan may be misread',
      );
    if (check(mrz2.slice(21, 27)) !== Number(mrz2[27]))
      out.issues.push(
        'The expiry-date check digit does not match: the scan may be misread',
      );
    const prev = lines[lines.indexOf(mrz2) - 1];
    const name = prev?.match(/^P[<A-Z]([A-Z<]{3})([A-Z<]+?)<<([A-Z<]+)/);
    if (name) {
      out.surname = name[2].replace(/</g, ' ').trim();
      out.givenNames = name[3].replace(/</g, ' ').trim();
    }
  } else {
    const num =
      /passport\s*(?:no\.?|number|#)?\s*[:-]?\s*([A-Z]{1,2}\d{6,8})/i.exec(
        text,
      );
    const exp =
      /(?:expiry|expires?|date of expiry)\s*[:-]?\s*(\d{4}-\d{2}-\d{2}|\d{2}[/.]\d{2}[/.]\d{4})/i.exec(
        text,
      );
    if (num) out.passportNumber = num[1].toUpperCase();
    if (exp) {
      const d = exp[1];
      out.expiryDate = /^\d{4}/.test(d)
        ? d
        : `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
    }
  }
  if (!out.passportNumber) out.issues.push('No passport number could be read');
  else if (!/^[A-Z0-9]{6,9}$/.test(out.passportNumber))
    out.issues.push('The passport number is not in a valid format');
  if (!out.expiryDate) out.issues.push('No expiry date could be read');
  else if (Number.isNaN(Date.parse(out.expiryDate)))
    out.issues.push('The expiry date is not a valid date');
  else if (Date.parse(out.expiryDate) < now.getTime())
    out.issues.push('The passport has already expired');
  else if (Date.parse(out.expiryDate) < now.getTime() + 183 * 86_400_000)
    out.issues.push('The passport expires within six months');
  if (
    out.passportNumber &&
    existing.passportNumber &&
    existing.passportNumber !== out.passportNumber
  )
    out.conflicts.push({
      field: 'passportNumber',
      existing: existing.passportNumber,
      proposed: out.passportNumber,
    });
  if (
    out.expiryDate &&
    existing.passportExpiryDate &&
    existing.passportExpiryDate.slice(0, 10) !== out.expiryDate
  )
    out.conflicts.push({
      field: 'passportExpiryDate',
      existing: existing.passportExpiryDate.slice(0, 10),
      proposed: out.expiryDate,
    });
  return out;
}

// ------------------------------------------------------------------------------------------ email and calls
export interface TriageResult {
  category: ReturnType<typeof classifySupport>['category'];
  team: string;
  summary: string;
  bookingReferences: string[];
  requests: string[];
  suggestedTasks: { title: string; reason: string }[];
  /** Always a draft: this system never sends it. */
  draftReply: string;
  requiresHumanApproval: boolean;
  approvalReasons: string[];
}

const REQUESTS: [string, RegExp][] = [
  ['wants a refund', /\brefund|money back\b/i],
  ['wants to cancel', /\bcancel/i],
  ['wants to change dates or details', /\b(change|amend|reschedule|move)\b/i],
  ['asks about payment', /\b(pay|payment|invoice|receipt|balance)\b/i],
  ['asks about a visa or documents', /\b(visa|passport|document)/i],
  ['wants a quotation', /\b(quote|quotation|price|how much|cost)\b/i],
];

export function triageMessage(
  subject: string,
  body: string,
  opts: { customerName?: string; channel: 'EMAIL' | 'CALL' } = {
    channel: 'EMAIL',
  },
): TriageResult {
  const text = `${subject}\n${body}`;
  const c = classifySupport(text);
  const refs = [
    ...new Set(
      (text.match(/\b[A-Z]{2,4}-[A-Z0-9]{5,}\b/g) ?? []).map((r: string) =>
        r.toUpperCase(),
      ),
    ),
  ].slice(0, 5);
  const requests = REQUESTS.filter(([, re]) => re.test(text)).map(
    ([label]) => label,
  );
  const sentences = body
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s/)
    .slice(0, 2)
    .join(' ')
    .slice(0, 300);
  const approvalReasons = [
    ...c.escalation.reasons,
    ...(requests.includes('wants a refund') ? ['it concerns a refund'] : []),
    ...(requests.includes('wants to cancel')
      ? ['it concerns a cancellation']
      : []),
  ];
  const name = opts.customerName ? `Dear ${opts.customerName}` : 'Hello';
  const channel = opts.channel === 'CALL' ? 'call' : 'message';
  const tasks = [
    ...(requests.length
      ? requests.map((r) => ({
          title: `Customer ${r}${refs.length ? ` (${refs.join(', ')})` : ''}`,
          reason: `From a ${channel}: "${sentences.slice(0, 120)}"`,
        }))
      : []),
    ...(c.complaint
      ? [
          {
            title: 'Complaint to review personally',
            reason:
              'The wording suggests a complaint; it must not be dismissed.',
          },
        ]
      : []),
  ];
  return {
    category: c.category,
    team: c.team,
    summary: sentences || '(no text)',
    bookingReferences: refs,
    requests,
    suggestedTasks: tasks.slice(0, 4),
    draftReply: `${name},\n\nThank you for contacting Alnajoum Travel Agency${refs.length ? ` about ${refs.join(', ')}` : ''}. We have passed your ${channel} to our ${c.team.toLowerCase()} team and someone will reply to you. If it is urgent, please call us.\n\nKind regards,\nAlnajoum Travel Agency`,
    requiresHumanApproval: c.escalation.escalate || approvalReasons.length > 0,
    approvalReasons: [...new Set(approvalReasons)],
  };
}
