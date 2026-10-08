export type SupportCategory =
  | 'BOOKING'
  | 'PAYMENT'
  | 'VISA'
  | 'HAJJ'
  | 'UMRAH'
  | 'HOTEL'
  | 'REFUND'
  | 'COMPLAINT'
  | 'TECHNICAL'
  | 'OTHER';

const RULES: [SupportCategory, RegExp][] = [
  ['REFUND', /\b(refund|money back|reimburse|chargeback)\b/i],
  [
    'PAYMENT',
    /\b(pay|paid|payment|invoice|receipt|charged|debit|transfer|bank|wallet)\b/i,
  ],
  ['VISA', /\b(visa|embassy|passport|consulate)\b/i],
  ['HAJJ', /\bhajj?\b/i],
  ['UMRAH', /\bumra?h?\b/i],
  ['HOTEL', /\b(hotel|room|check-?in|check-?out|accommodation)\b/i],
  [
    'BOOKING',
    /\b(flight|ticket|booking|reservation|itinerary|airline|seat|baggage)\b/i,
  ],
  [
    'TECHNICAL',
    /\b(login|log in|password|error|bug|app|website|page|crash|cannot open|can't open)\b/i,
  ],
];

const TEAM: Record<SupportCategory, string> = {
  BOOKING: 'Flight operations',
  PAYMENT: 'Finance',
  VISA: 'Visa desk',
  HAJJ: 'Hajj operations',
  UMRAH: 'Umrah operations',
  HOTEL: 'Hotel desk',
  REFUND: 'Finance',
  COMPLAINT: 'Customer care manager',
  TECHNICAL: 'Technical support',
  OTHER: 'Customer care',
};

export interface SupportClassification {
  category: SupportCategory;
  team: string;
  complaint: boolean;
  /** Reasons a person should look at this soon; never a reason to dismiss it. */
  escalation: { escalate: boolean; reasons: string[] };
}

const COMPLAINT =
  /\b(complain|complaint|unacceptable|terrible|worst|scam|fraud|cheat(?:ed)?|stolen|lawyer|legal action|sue\b|police|report you|disgusted|furious|angry|still waiting|again and again|third time|no one (?:has )?(?:replied|responded))\b/i;
const LEGAL =
  /\b(lawyer|legal|sue\b|court|police|regulator|ombudsman|consumer protection)\b/i;
const MONEY = /\b(refund|money|paid|payment|charged|lost)\b/i;
const URGENT =
  /\b(today|tomorrow|tonight|urgent|immediately|asap|now|flight (?:is )?(?:in|at)|departing)\b/i;
const REPEAT =
  /\b(again|still|third time|no one|nobody|already told|as i said|reminder)\b/i;

/** Rule-based triage: classifies a message and decides whether it deserves escalation. It never decides to ignore one. */
export function classifySupport(text: string): SupportClassification {
  const complaint = COMPLAINT.test(text);
  const matched = RULES.find(([, re]) => re.test(text))?.[0];
  const category: SupportCategory =
    complaint && !matched
      ? 'COMPLAINT'
      : (matched ?? (complaint ? 'COMPLAINT' : 'OTHER'));
  const reasons: string[] = [];
  if (LEGAL.test(text)) reasons.push('legal or regulatory sensitivity');
  if (complaint && MONEY.test(text)) reasons.push('financial impact');
  if (
    URGENT.test(text) &&
    /\b(flight|travel|depart|visa|hajj|umrah)\b/i.test(text)
  )
    reasons.push('travel is imminent');
  if (REPEAT.test(text) && complaint) reasons.push('repeated failure');
  if (complaint && reasons.length === 0) reasons.push('customer complaint');
  return {
    category,
    team: TEAM[category === 'COMPLAINT' ? 'COMPLAINT' : category],
    complaint,
    escalation: { escalate: complaint || reasons.length > 0, reasons },
  };
}
