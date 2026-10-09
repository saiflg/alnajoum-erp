/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
// This test double reads arbitrary tool-output JSON to decide what to say next, so it is deliberately loosely typed.
import { Confidence, ModelAction } from '../agent.types';

/**
 * Deterministic stand-in for a language model, used on localhost and in every automated test (no external AI
 * credentials needed). It is a rule-based planner, NOT a model: it classifies the request (English, Hausa,
 * Arabic keywords), asks for the tools a real model would ask for, and writes the answer with `{{fact}}`
 * placeholders that the runtime fills from real tool results. It speaks the same JSON protocol a real
 * provider is instructed to speak, so everything above it (policy, approvals, guards, budgets) is exercised
 * identically.
 */
export interface PlannerRequest {
  agent: string;
  language: string;
  objective: string;
  history: { role: string; content: string }[];
  tools: string[];
  toolResults: {
    tool: string;
    input: Record<string, unknown>;
    ok: boolean;
    output?: Record<string, any>;
    error?: string;
  }[];
  memory: Record<string, any>;
  /** The delegate results, keyed by agent, for supervisors. */
  delegations?: { agent: string; message: string; status: string }[];
}

type L = 'en' | 'ha' | 'ar';
const lang = (l: string): L => (l === 'ha' || l === 'ar' ? l : 'en');
const tr = (l: string, v: { en: string; ha?: string; ar?: string }): string =>
  v[lang(l)] ?? v.en;

const CITY: Record<string, string> = {
  kano: 'KAN',
  lagos: 'LOS',
  abuja: 'ABV',
  jeddah: 'JED',
  jidda: 'JED',
  madinah: 'MED',
  medina: 'MED',
  makkah: 'JED',
  mecca: 'JED',
  dubai: 'DXB',
  london: 'LHR',
  istanbul: 'IST',
  cairo: 'CAI',
  'port harcourt': 'PHC',
  kaduna: 'KAD',
  accra: 'ACC',
  doha: 'DOH',
  'addis ababa': 'ADD',
  nairobi: 'NBO',
};
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export function parseCities(text: string): {
  origin?: string;
  destination?: string;
} {
  const lower = text.toLowerCase();
  const from =
    /\bfrom\s+([a-z ]+?)\s+to\s+([a-z ]+?)(?=\s+(?:on|for|next|in|around|by|and|return)\b|[.,?!]|$)/.exec(
      lower,
    );
  const find = (s?: string) => {
    if (!s) return undefined;
    const t = s.trim();
    if (/^[a-z]{3}$/.test(t) && !CITY[t]) return t.toUpperCase();
    return CITY[t];
  };
  if (from) return { origin: find(from[1]), destination: find(from[2]) };
  const found = Object.keys(CITY).filter((c) => lower.includes(c));
  if (found.length >= 2) {
    found.sort((a, b) => lower.indexOf(a) - lower.indexOf(b));
    return { origin: CITY[found[0]], destination: CITY[found[1]] };
  }
  return {};
}

export function parseDates(text: string, now = new Date()): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const push = (y: number, m: number, d: number) => {
    let year = y;
    let date = new Date(Date.UTC(year, m, d));
    if (
      y === now.getUTCFullYear() &&
      date.getTime() < now.getTime() - 86_400_000
    )
      date = new Date(Date.UTC(++year, m, d));
    if (date.getUTCMonth() === m) out.push(date.toISOString().slice(0, 10));
  };
  for (const m of lower.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))
    out.push(`${m[1]}-${m[2]}-${m[3]}`);
  const re = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.map((x) => x.slice(0, 3)).join('|')})[a-z]*\\b`,
    'g',
  );
  for (const m of lower.matchAll(re))
    push(
      now.getUTCFullYear(),
      MONTHS.findIndex((x) => x.startsWith(m[2])),
      Number(m[1]),
    );
  const re2 = new RegExp(
    `\\b(${MONTHS.map((x) => x.slice(0, 3)).join('|')})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
    'g',
  );
  for (const m of lower.matchAll(re2))
    push(
      now.getUTCFullYear(),
      MONTHS.findIndex((x) => x.startsWith(m[1])),
      Number(m[2]),
    );
  return [...new Set(out)].sort();
}

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

export function isAffirmation(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    /^(yes|yep|yeah|ok|okay|sure|confirm|confirmed|go ahead|book it|please book|i confirm|proceed|eh|ee|e|na'am|نعم|أؤكد|تأكيد)\b/.test(
      t,
    ) ||
    /\bconfirm(?:ed)?\b/.test(t) ||
    /\bbook (?:it|this|option)\b/.test(t)
  );
}

export type Intent =
  | 'BALANCE'
  | 'BOOKINGS'
  | 'VISA'
  | 'DOCUMENTS'
  | 'PAYMENT_LINK'
  | 'PAYMENT_CLAIM'
  | 'PAYMENT_STATUS'
  | 'FLIGHT_SEARCH'
  | 'CONFIRM_BOOKING'
  | 'CANCEL'
  | 'REFUND'
  | 'KNOWLEDGE'
  | 'HANDOFF'
  | 'HOTEL'
  | 'READINESS'
  | 'REVENUE'
  | 'FOLLOW_UPS'
  | 'APPROVALS'
  | 'SUMMARY'
  | 'CREATE_TASK'
  | 'SUPPLIER'
  | 'UNKNOWN';

export function classify(text: string, memory: Record<string, any>): Intent {
  const t = text.toLowerCase();
  if (
    has(
      t,
      'speak to a human',
      'talk to a human',
      'real person',
      'human agent',
      'speak to staff',
      'talk to staff',
      "ma'aikaci",
      'موظف',
      'complaint',
      'complain',
      'scam',
      'lawyer',
      'sue ',
      'fraud',
      'angry',
      'unacceptable',
    )
  )
    return 'HANDOFF';
  if (memory?.pendingOffer && isAffirmation(text)) return 'CONFIRM_BOOKING';
  if (
    has(
      t,
      'i paid',
      'i have paid',
      'already paid',
      'payment completed',
      'payment is done',
      'paid already',
      'na biya',
      'دفعت',
    )
  )
    return 'PAYMENT_CLAIM';
  const hasRef = /\b[A-Z]{2,4}-[A-Z0-9]{4,}\b/i.test(text);
  if (has(t, 'create a task', 'create task', 'remind me', 'add a task'))
    return 'CREATE_TASK';
  const policyQuestion =
    /\b(policy|policies|procedure|requirements?|terms|rules?)\b/.test(t) ||
    /\bhow long (does|will|is|do)\b/.test(t);
  if (
    policyQuestion &&
    !hasRef &&
    !has(t, 'my booking', 'my refund', 'i want a refund', 'cancel my')
  )
    return 'KNOWLEDGE';
  if (
    has(
      t,
      'payment link',
      'pay link',
      'send me a link',
      'link to pay',
      'how can i pay',
      'pay now',
      'رابط الدفع',
      'hanyar biya',
    )
  )
    return 'PAYMENT_LINK';
  if (has(t, 'refund', 'money back')) return 'REFUND';
  if (has(t, 'cancel')) return 'CANCEL';
  if (
    has(
      t,
      'owe',
      'balance',
      'outstanding',
      'how much do i',
      'how much is left',
      'remaining',
      'bashi',
      'nawa nake',
      'المبلغ المتبقي',
      'رصيد',
      'مستحق',
      'كم علي',
    )
  )
    return 'BALANCE';
  if (has(t, 'payment status', 'did my payment', 'has my payment'))
    return 'PAYMENT_STATUS';
  if (has(t, 'visa', 'visas', 'تأشيرة'))
    return has(t, 'document', 'missing', 'takard') ? 'DOCUMENTS' : 'VISA';
  if (has(t, 'document', 'passport', 'takard', 'مستند', 'وثائق'))
    return 'DOCUMENTS';
  if (
    has(
      t,
      'readiness',
      'ready for departure',
      'umrah group',
      'hajj group',
      'my group',
    )
  )
    return 'READINESS';
  if (
    has(t, 'hotel', 'otal', 'فندق') &&
    has(t, 'search', 'find', 'available', 'availability', 'need', 'room')
  )
    return 'HOTEL';
  if (
    has(
      t,
      'my hotel',
      'show my hotel',
      'my booking',
      'my trip',
      'my trips',
      'upcoming',
      'booking status',
      'tikiti na',
      'حجز',
      'رحلاتي',
    )
  )
    return 'BOOKINGS';
  if (
    has(t, 'flight', 'fly', 'travel from', 'jirgi', 'رحلة', 'طيران') ||
    /\bfrom\s+\w+\s+to\s+\w+/.test(t)
  )
    return 'FLIGHT_SEARCH';
  if (
    has(
      t,
      'policy',
      'procedure',
      'how long',
      'how do i',
      'what is the rule',
      'requirements',
      'terms',
      'sharudda',
    )
  )
    return 'KNOWLEDGE';
  if (
    has(
      t,
      'revenue',
      'sales',
      'profit',
      'bookings volume',
      'kpi',
      'how are we doing',
      'cancelled bookings',
      'top routes',
      'supplier liabilities',
      'pending incentives',
      'visas expiring',
    )
  )
    return 'REVENUE';
  if (
    has(
      t,
      'follow-up',
      'follow up',
      'followup',
      'need action',
      'delayed',
      'overdue',
      'unpaid',
    )
  )
    return 'FOLLOW_UPS';
  if (has(t, 'pending approval', 'my approvals', 'waiting for approval'))
    return 'APPROVALS';
  if (has(t, 'summar', 'today', 'briefing', 'operations')) return 'SUMMARY';
  if (has(t, 'supplier')) return 'SUPPLIER';
  return 'UNKNOWN';
}

const last = (r: PlannerRequest, tool: string) =>
  [...r.toolResults].reverse().find((x) => x.tool === tool);
const final = (
  text: string,
  confidence: Confidence = 'HIGH',
  extra: { needsInfo?: boolean; sources?: string[] } = {},
): ModelAction => ({ action: 'final', text, confidence, ...extra });
const tool = (
  name: string,
  input: Record<string, unknown> = {},
  why?: string,
): ModelAction => ({ action: 'tool', tool: name, input, why });
export function planNext(r: PlannerRequest, now = new Date()): ModelAction {
  const L = r.language;
  const text = r.objective;
  const t = text.toLowerCase();
  const can = (tn: string) => r.tools.includes(tn);
  const intent = classify(text, r.memory);
  const failed = r.toolResults.find((x) => !x.ok);

  // A failed tool is reported honestly; the model never papers over it.
  if (failed && failed.tool !== 'searchFlights') {
    return final(
      tr(L, {
        en: `I couldn't complete that: ${failed.error}`,
        ha: `Ban iya kammala hakan ba: ${failed.error}`,
        ar: `تعذر إكمال ذلك: ${failed.error}`,
      }),
      'LOW',
    );
  }

  if (r.agent === 'operations_supervisor')
    return planSupervisor(r, intent, can);

  switch (intent) {
    case 'HANDOFF':
      return {
        action: 'handoff',
        reason: 'The customer asked for a person, or raised a complaint',
      };

    case 'BALANCE': {
      if (!last(r, 'getCustomerBalance'))
        return tool(
          'getCustomerBalance',
          {},
          'Read the ledger for what is owed',
        );
      const o = last(r, 'getCustomerBalance')!.output!;
      if (o.unpaidCount === 0)
        return final(
          tr(L, {
            en: 'You have no outstanding invoices.',
            ha: 'Ba ka da wani bashi a halin yanzu.',
            ar: 'ليس لديك فواتير مستحقة.',
          }),
          'HIGH',
          { sources: ['finance_ledger'] },
        );
      const lines = (o.invoices as any[])
        .slice(0, 3)
        .map(
          (_, i) =>
            `• {{getCustomerBalance.invoices.${i}.number}}: {{getCustomerBalance.invoices.${i}.outstanding}}`,
        )
        .join('\n');
      const head = o.mixedCurrencies
        ? tr(L, {
            en: 'You have unpaid invoices in more than one currency, so there is no single total:',
            ha: 'Kana da bashin kuɗi daban-daban, don haka babu jimla ɗaya:',
            ar: 'لديك فواتير بعملات مختلفة لذا لا يوجد مجموع واحد:',
          })
        : tr(L, {
            en: 'You currently owe {{getCustomerBalance.outstanding}} across {{getCustomerBalance.unpaidCount}} unpaid invoice(s):',
            ha: 'A yanzu kana bin {{getCustomerBalance.outstanding}} a cikin takardun biyan kuɗi {{getCustomerBalance.unpaidCount}}:',
            ar: 'المبلغ المستحق عليك الآن {{getCustomerBalance.outstanding}} في {{getCustomerBalance.unpaidCount}} فاتورة:',
          });
      return final(
        `${head}\n${lines}\n${tr(L, { en: 'Your wallet balance is {{getCustomerBalance.walletBalance}}.', ha: 'Kuɗin da ke cikin walat ɗinka shi ne {{getCustomerBalance.walletBalance}}.', ar: 'رصيد محفظتك {{getCustomerBalance.walletBalance}}.' })}`,
        'HIGH',
        { sources: ['finance_ledger'] },
      );
    }

    case 'BOOKINGS': {
      if (!last(r, 'getMyBookings'))
        return tool('getMyBookings', {}, "List the customer's bookings");
      const o = last(r, 'getMyBookings')!.output!;
      const c = o.counts;
      if (!c.flights && !c.hotels && !c.hajj && !c.umrah && !c.visas)
        return final(
          tr(L, {
            en: 'I could not find any bookings on your account.',
            ha: 'Ban sami wani tikiti a asusunka ba.',
            ar: 'لم أجد أي حجوزات في حسابك.',
          }),
          'HIGH',
          { sources: ['erp_bookings'] },
        );
      const parts: string[] = [];
      (o.flights as any[])
        .slice(0, 3)
        .forEach((_, i) =>
          parts.push(
            `• ${tr(L, { en: 'Flight', ha: 'Jirgi', ar: 'رحلة' })} {{getMyBookings.flights.${i}.bookingReference}} {{getMyBookings.flights.${i}.origin}}→{{getMyBookings.flights.${i}.destination}} — {{getMyBookings.flights.${i}.status}}, {{getMyBookings.flights.${i}.total}}`,
          ),
        );
      (o.hotels as any[])
        .slice(0, 2)
        .forEach((_, i) =>
          parts.push(
            `• ${tr(L, { en: 'Hotel', ha: 'Otal', ar: 'فندق' })} {{getMyBookings.hotels.${i}.hotelName}} — {{getMyBookings.hotels.${i}.status}}`,
          ),
        );
      (o.umrah as any[])
        .slice(0, 2)
        .forEach((_, i) =>
          parts.push(
            `• Umrah {{getMyBookings.umrah.${i}.registrationNumber}} — {{getMyBookings.umrah.${i}.status}}, {{getMyBookings.umrah.${i}.total}}`,
          ),
        );
      (o.hajj as any[])
        .slice(0, 2)
        .forEach((_, i) =>
          parts.push(
            `• Hajj {{getMyBookings.hajj.${i}.registrationNumber}} — {{getMyBookings.hajj.${i}.status}}, {{getMyBookings.hajj.${i}.total}}`,
          ),
        );
      (o.visas as any[])
        .slice(0, 2)
        .forEach((_, i) =>
          parts.push(
            `• Visa {{getMyBookings.visas.${i}.applicationReference}} ({{getMyBookings.visas.${i}.destinationCountry}}) — {{getMyBookings.visas.${i}.status}}`,
          ),
        );
      return final(
        `${tr(L, { en: 'Here is what I can see on your account:', ha: 'Ga abin da nake gani a asusunka:', ar: 'هذا ما أراه في حسابك:' })}\n${parts.join('\n')}`,
        'HIGH',
        { sources: ['erp_bookings'] },
      );
    }

    case 'VISA':
    case 'DOCUMENTS': {
      if (!last(r, 'getVisaApplications'))
        return tool(
          'getVisaApplications',
          {},
          'Read visa applications and their checklist',
        );
      const o = last(r, 'getVisaApplications')!.output!;
      if (!o.count)
        return final(
          tr(L, {
            en: 'You do not have a visa application on file yet.',
            ha: 'Ba ka da takardar neman visa a yanzu.',
            ar: 'ليس لديك طلب تأشيرة حاليًا.',
          }),
          'HIGH',
          { sources: ['erp_visa'] },
        );
      const parts = (o.applications as any[]).slice(0, 3).map((a, i) => {
        const miss = [...a.missingDocuments, ...a.rejectedOrExpiredDocuments];
        const missText = miss.length
          ? tr(L, {
              en: `Missing or needs replacing: {{getVisaApplications.applications.${i}.missingDocuments}}`,
              ha: `Ya ɓace ko ana buƙatar sauyawa: {{getVisaApplications.applications.${i}.missingDocuments}}`,
              ar: `ناقص أو يحتاج استبدال: {{getVisaApplications.applications.${i}.missingDocuments}}`,
            })
          : tr(L, {
              en: 'No missing documents on the checklist.',
              ha: 'Babu takardar da ta ɓace.',
              ar: 'لا توجد مستندات ناقصة.',
            });
        return `• {{getVisaApplications.applications.${i}.applicationReference}} ({{getVisaApplications.applications.${i}.destinationCountry}}): {{getVisaApplications.applications.${i}.status}}. ${missText}`;
      });
      return final(
        `${parts.join('\n')}\n${tr(L, { en: 'I cannot predict when a visa will be issued; that depends on the authority.', ha: 'Ba zan iya hasashen lokacin da za a ba da visa ba; ya dogara ga hukuma.', ar: 'لا أستطيع التنبؤ بموعد صدور التأشيرة فهو يعتمد على الجهة المختصة.' })}`,
        'HIGH',
        { sources: ['erp_visa', 'visa_checklist'] },
      );
    }

    case 'READINESS': {
      const pilgrim = last(r, 'getMyBookings');
      if (!pilgrim) return tool('getMyBookings');
      return final(
        tr(L, {
          en: 'Your group and readiness details are managed by our Hajj/Umrah team. I have your registration on file; please ask a staff member for the group assignment.',
          ha: "Ƙungiyar Hajji/Umra ce ke kula da bayanan rukuninka. Ka tambayi ma'aikaci.",
          ar: 'فريق الحج والعمرة يدير تفاصيل مجموعتك. يرجى سؤال أحد الموظفين.',
        }),
        'MEDIUM',
        { sources: ['erp_bookings'] },
      );
    }

    case 'PAYMENT_LINK': {
      if (!can('createPaymentLink'))
        return final(
          tr(L, { en: 'Please use the Pay button on your invoice.' }),
          'MEDIUM',
        );
      if (!last(r, 'getCustomerBalance')) return tool('getCustomerBalance');
      const bal = last(r, 'getCustomerBalance')!.output!;
      const inv = bal.invoices as any[];
      if (!inv.length)
        return final(
          tr(L, {
            en: 'You have nothing to pay right now.',
            ha: 'Ba ka da abin biya yanzu.',
            ar: 'لا يوجد ما تدفعه الآن.',
          }),
          'HIGH',
          { sources: ['finance_ledger'] },
        );
      const wanted = inv.find((i) =>
        t.includes(String(i.number).toLowerCase()),
      );
      const pick = wanted ?? (inv.length === 1 ? inv[0] : undefined);
      if (!pick) {
        const list = inv
          .slice(0, 5)
          .map(
            (_, i) =>
              `• {{getCustomerBalance.invoices.${i}.number}}: {{getCustomerBalance.invoices.${i}.outstanding}}`,
          )
          .join('\n');
        return final(
          `${tr(L, { en: 'Which invoice would you like to pay? Reply with its number.', ha: 'Wace takarda kake so ka biya? Ka amsa da lambarta.', ar: 'أي فاتورة تريد دفعها؟ أجب برقمها.' })}\n${list}`,
          'HIGH',
          { needsInfo: true, sources: ['finance_ledger'] },
        );
      }
      if (!last(r, 'createPaymentLink'))
        return tool(
          'createPaymentLink',
          { invoiceId: pick.invoiceId },
          'Create the provider checkout link',
        );
      const idx = Math.max(0, inv.indexOf(pick));
      return final(
        `${tr(L, { en: `Here is your secure payment link for {{getCustomerBalance.invoices.${idx}.number}} ({{getCustomerBalance.invoices.${idx}.outstanding}} outstanding):`, ha: 'Ga hanyar biyan kuɗin ka:', ar: 'هذا رابط الدفع الآمن الخاص بك:' })}\n{{createPaymentLink.paymentUrl}}\n${tr(L, { en: 'The invoice is only marked paid after the payment provider confirms it.', ha: 'Sai mai biyan kuɗi ya tabbatar kafin a rubuta cewa an biya.', ar: 'لا تُعتبر الفاتورة مدفوعة إلا بعد تأكيد مزود الدفع.' })}`,
        'HIGH',
        { sources: ['payment_provider', 'finance_ledger'] },
      );
    }

    case 'PAYMENT_CLAIM': {
      if (!last(r, 'getCustomerBalance'))
        return tool(
          'getCustomerBalance',
          {},
          'Check what is actually recorded',
        );
      const bal = last(r, 'getCustomerBalance')!.output!;
      if (!bal.unpaidCount)
        return final(
          tr(L, {
            en: 'Yes — I can see no unpaid invoices on your account, so your payments are recorded.',
            ha: 'Eh — ban ga wani bashi a asusunka ba, an rubuta biyanka.',
            ar: 'نعم، لا أرى فواتير غير مدفوعة في حسابك.',
          }),
          'HIGH',
          { sources: ['finance_ledger'] },
        );
      // CONFLICT: the customer says paid, the ledger says unpaid. Do not guess; ask finance to verify.
      if (can('createSupportTicket') && !last(r, 'createSupportTicket'))
        return tool('createSupportTicket', {
          subject: 'Customer says a payment was made but it is not recorded',
          description: `The customer reports having paid. The ledger still shows ${bal.unpaidCount} unpaid invoice(s). Finance should verify with the bank/provider.`,
        });
      if (can('createTask') && !last(r, 'createTask'))
        return tool('createTask', {
          title: 'Verify a payment the customer says was made',
          description:
            'Ledger shows it unpaid; verify with provider/bank before any change.',
          relatedType: 'PAYMENT',
          priority: 'HIGH',
        });
      return final(
        tr(L, {
          en: "I can't see that payment recorded on your invoices yet. I have asked our finance team to verify it. I won't mark anything as paid myself — it is confirmed only once the provider or the bank shows it.",
          ha: 'Ban ga wannan biyan a rubuce ba tukuna. Na nemi ƙungiyar kuɗi ta tabbatar. Ba zan rubuta cewa an biya da kaina ba.',
          ar: 'لا أرى هذه الدفعة مسجلة بعد. طلبت من فريق المالية التحقق. لن أعتبرها مدفوعة بنفسي.',
        }),
        'HIGH',
        { sources: ['finance_ledger'] },
      );
    }

    case 'PAYMENT_STATUS': {
      if (!last(r, 'getCustomerBalance')) return tool('getCustomerBalance');
      return final(
        tr(L, {
          en: 'Unpaid invoices on your account: {{getCustomerBalance.unpaidCount}}; total outstanding {{getCustomerBalance.outstanding}}. A payment appears only once it is recorded.',
          ha: 'Takardun da ba a biya ba: {{getCustomerBalance.unpaidCount}}.',
          ar: 'عدد الفواتير غير المدفوعة: {{getCustomerBalance.unpaidCount}}.',
        }),
        'HIGH',
        { sources: ['finance_ledger'] },
      );
    }

    case 'FLIGHT_SEARCH': {
      if (!can('searchFlights'))
        return {
          action: 'handoff',
          reason: 'Flight search is not available to this agent',
        };
      const { origin, destination } = parseCities(text);
      const dates = parseDates(text, now);
      const need: string[] = [];
      if (!origin)
        need.push(
          tr(L, {
            en: 'where you are flying from',
            ha: 'daga ina za ka tashi',
            ar: 'من أين ستسافر',
          }),
        );
      if (!destination)
        need.push(
          tr(L, {
            en: 'where you are going',
            ha: 'inda za ka je',
            ar: 'إلى أين',
          }),
        );
      if (!dates.length)
        need.push(
          tr(L, {
            en: 'your departure date (for example 10 October)',
            ha: 'ranar tashi',
            ar: 'تاريخ المغادرة',
          }),
        );
      if (need.length)
        return final(
          `${tr(L, { en: 'To search I still need:', ha: 'Don bincike ina bukatar:', ar: 'للبحث أحتاج إلى:' })} ${need.join(', ')}.`,
          'HIGH',
          { needsInfo: true },
        );
      if (!last(r, 'searchFlights'))
        return tool(
          'searchFlights',
          {
            origin,
            destination,
            departureDate: dates[0],
            ...(dates[1] ? { returnDate: dates[1] } : {}),
            adults: 1,
          },
          'Search the active flight providers',
        );
      const res = last(r, 'searchFlights')!;
      if (!res.ok || !res.output?.offers?.length)
        return final(
          tr(L, {
            en: 'I could not find available flights for those dates from the provider. Would you like to try different dates?',
            ha: 'Ban sami jirgi ba a waɗannan ranakun. Kana son wasu ranaku?',
            ar: 'لم أجد رحلات متاحة في هذه التواريخ. هل تريد تواريخ أخرى؟',
          }),
          'MEDIUM',
          { sources: ['flight_provider'] },
        );
      const offers = (res.output.offers as any[]).slice(0, 3);
      const lines = offers.map((o, i) => {
        const ref = `{{searchFlights.offers.${i}`;
        return `${i + 1}. ${ref}.legs.0.airline}} ${ref}.legs.0.flight}} · ${ref}.provider}} · ${ref}.total}} · ${tr(L, { en: 'refundable', ha: 'maidawowa', ar: 'قابل للاسترداد' })}: ${ref}.refundable}} · ${tr(L, { en: 'baggage', ha: 'kaya', ar: 'الأمتعة' })}: ${o.baggage?.checked ? `${ref}.baggage.checked}}` : tr(L, { en: 'not verified by the provider', ha: 'mai bayarwa bai tabbatar ba', ar: 'غير مؤكد من المزود' })}${o.changeRules ? ` · ${tr(L, { en: 'changes', ha: 'sauyi', ar: 'التغيير' })}: ${ref}.changeRules}}` : ''}`;
      });
      return final(
        `${tr(L, { en: 'Here are the options from the provider:', ha: 'Ga zaɓuɓɓukan daga mai bayarwa:', ar: 'هذه الخيارات من المزود:' })}\n${lines.join('\n')}\n${tr(L, { en: 'Fare rules not shown could not be verified from the provider data. Reply "confirm 1" (or 2, 3) and I will re-check the price and prepare the booking. Nothing is booked yet.', ha: 'Ka rubuta "confirm 1" in sake duba farashi in shirya. Ba a yi komai ba tukuna.', ar: 'اكتب "confirm 1" وسأعيد التحقق من السعر وأجهز الحجز. لم يتم الحجز بعد.' })}`,
        'HIGH',
        { sources: ['flight_provider', 'pricing_engine'] },
      );
    }

    case 'CONFIRM_BOOKING': {
      const pending = r.memory.pendingOffer as {
        offers: { offerId: string; amount: number }[];
      };
      const n = /\b([1-3])\b/.exec(t);
      const choice =
        pending.offers[(n ? Number(n[1]) : 1) - 1] ?? pending.offers[0];
      if (!choice)
        return final(tr(L, { en: 'Which option would you like?' }), 'MEDIUM', {
          needsInfo: true,
        });
      if (!last(r, 'revalidateFlightOffer'))
        return tool(
          'revalidateFlightOffer',
          { offerId: choice.offerId, previousAmount: choice.amount },
          'Revalidate before booking',
        );
      const rv = last(r, 'revalidateFlightOffer')!.output!;
      if (rv.priceChanged)
        return final(
          tr(L, {
            en: 'The price has changed from {{revalidateFlightOffer.previous}} to {{revalidateFlightOffer.current}}. Reply "confirm" again to accept the new price.',
            ha: 'Farashi ya canza daga {{revalidateFlightOffer.previous}} zuwa {{revalidateFlightOffer.current}}. Ka sake rubuta "confirm".',
            ar: 'تغير السعر من {{revalidateFlightOffer.previous}} إلى {{revalidateFlightOffer.current}}. اكتب "confirm" مرة أخرى للموافقة.',
          }),
          'HIGH',
          { sources: ['flight_provider'] },
        );
      if (!last(r, 'prepareFlightBooking'))
        return tool(
          'prepareFlightBooking',
          {
            offerId: choice.offerId,
            expectedPrice: rv.current.amount,
            customerConfirmed: true,
          },
          'Book through the normal workflow',
        );
      return final(
        tr(L, {
          en: 'Your booking {{prepareFlightBooking.bookingReference}} is reserved at {{prepareFlightBooking.total}}. Please pay the invoice to continue to ticketing — I can send you a payment link.',
          ha: 'An ajiye tikitinka {{prepareFlightBooking.bookingReference}} a kan {{prepareFlightBooking.total}}. Ka biya takardar don a ci gaba.',
          ar: 'تم حجز {{prepareFlightBooking.bookingReference}} بمبلغ {{prepareFlightBooking.total}}. يرجى دفع الفاتورة للمتابعة.',
        }),
        'HIGH',
        { sources: ['erp_flight_booking'] },
      );
    }

    case 'HOTEL': {
      if (!can('getHotelAvailability'))
        return {
          action: 'handoff',
          reason: 'Hotel search is not available to this agent',
        };
      const dates = parseDates(text, now);
      const city = Object.keys(CITY).find((c) => t.includes(c));
      if (!city || dates.length < 2)
        return final(
          tr(L, {
            en: 'To search hotels I need the city, check-in and check-out dates (for example 10 October to 15 October).',
          }),
          'HIGH',
          { needsInfo: true },
        );
      if (!last(r, 'getHotelAvailability'))
        return tool('getHotelAvailability', {
          city: city.replace(/^./, (c) => c.toUpperCase()),
          checkInDate: dates[0],
          checkOutDate: dates[1],
        });
      const o = last(r, 'getHotelAvailability')!.output!;
      if (!o.count)
        return final(
          tr(L, {
            en: 'No hotel availability came back from the provider for those dates.',
          }),
          'MEDIUM',
          { sources: ['hotel_provider'] },
        );
      const lines = (o.offers as any[])
        .slice(0, 3)
        .map(
          (_, i) =>
            `• {{getHotelAvailability.offers.${i}.hotel}} ({{getHotelAvailability.offers.${i}.stars}}★) — {{getHotelAvailability.offers.${i}.total}}`,
        );
      return final(
        `${tr(L, { en: 'Available hotels:' })}\n${lines.join('\n')}`,
        'HIGH',
        { sources: ['hotel_provider'] },
      );
    }

    case 'CANCEL':
    case 'REFUND': {
      const ref = /\b(ANJ-[A-Z0-9]+|[A-Z]{2,4}-[A-Z0-9]{4,})\b/i
        .exec(text)?.[1]
        ?.toUpperCase();
      const name =
        intent === 'CANCEL' ? 'cancelFlightBooking' : 'requestFlightRefund';
      if (!ref)
        return final(
          tr(L, {
            en: 'Please give me the booking reference (it starts with ANJ-) and I will send your request to our team.',
            ha: 'Ka ba ni lambar tikitin.',
            ar: 'يرجى إعطائي رقم الحجز.',
          }),
          'HIGH',
          { needsInfo: true },
        );
      if (!can(name))
        return { action: 'handoff', reason: 'This agent cannot request that' };
      if (!last(r, name))
        return tool(
          name,
          { bookingReference: ref, reason: text.slice(0, 300) },
          'Needs human approval before anything happens',
        );
      return final(
        tr(L, {
          en: 'That needs approval from our team before it can happen. I have sent the request and you will be told the outcome.',
          ha: 'Wannan yana bukatar amincewar ƙungiyarmu. Na aika da buƙatar.',
          ar: 'هذا يحتاج إلى موافقة فريقنا. تم إرسال الطلب.',
        }),
        'HIGH',
      );
    }

    case 'KNOWLEDGE': {
      if (!can('searchKnowledge'))
        return { action: 'handoff', reason: 'No knowledge access' };
      if (!last(r, 'searchKnowledge'))
        return tool('searchKnowledge', { query: text.slice(0, 200) });
      const o = last(r, 'searchKnowledge')!.output!;
      if (!o.found)
        return {
          action: 'handoff',
          reason: 'No policy covers this question; a person should answer',
        };
      return final(
        `${tr(L, { en: 'According to {{searchKnowledge.entries.0.sourceLabel}}:', ha: 'Bisa ga {{searchKnowledge.entries.0.sourceLabel}}:', ar: 'وفقًا لـ {{searchKnowledge.entries.0.sourceLabel}}:' })}\n{{searchKnowledge.entries.0.excerpt}}`,
        'HIGH',
        { sources: ['knowledge_base'] },
      );
    }

    case 'REVENUE': {
      if (!can('getAnalyticsMetric'))
        return final(
          tr(L, { en: 'You do not have access to analytics through me.' }),
          'HIGH',
        );
      const days = /(\d+)\s*day/.exec(t)
        ? Number(/(\d+)\s*day/.exec(t)![1])
        : has(t, 'today')
          ? 1
          : has(t, 'week')
            ? 7
            : has(t, 'year')
              ? 365
              : 30;
      const q = has(t, 'cancel')
        ? 'cancelled_bookings_count'
        : has(t, 'route')
          ? 'top_routes_by_revenue'
          : has(t, 'supplier')
            ? 'supplier_liabilities'
            : has(t, 'incentive')
              ? 'pending_incentives'
              : has(t, 'visa')
                ? 'visas_expiring_soon'
                : has(t, 'branch')
                  ? 'branch_sales'
                  : 'executive_kpis';
      if (!last(r, 'getAnalyticsMetric'))
        return tool(
          'getAnalyticsMetric',
          { query: q, days },
          'Run the approved analytics query',
        );
      return final('{{getAnalyticsMetric.summary}}', 'HIGH', {
        sources: [`analytics:${q}`],
      });
    }

    case 'FOLLOW_UPS':
    case 'SUMMARY': {
      if (can('getOperationalSummary') && !last(r, 'getOperationalSummary'))
        return tool('getOperationalSummary', { limit: 8 });
      if (
        intent === 'SUMMARY' &&
        can('getPendingApprovals') &&
        !last(r, 'getPendingApprovals')
      )
        return tool('getPendingApprovals');
      if (
        intent === 'FOLLOW_UPS' &&
        can('getLeadsNeedingFollowUp') &&
        !last(r, 'getLeadsNeedingFollowUp')
      )
        return tool('getLeadsNeedingFollowUp');
      const q = last(r, 'getOperationalSummary')?.output;
      const items = ((q?.queue as any[]) ?? [])
        .slice(0, 5)
        .map(
          (_, i) =>
            `• [{{getOperationalSummary.queue.${i}.severity}}] {{getOperationalSummary.queue.${i}.title}}`,
        );
      const extra = [
        last(r, 'getPendingApprovals')
          ? 'Pending approvals: {{getPendingApprovals.count}}.'
          : '',
        last(r, 'getLeadsNeedingFollowUp')
          ? 'Leads gone quiet: {{getLeadsNeedingFollowUp.count}}.'
          : '',
        q
          ? 'Your overdue tasks: {{getOperationalSummary.myOverdueTasks}}.'
          : '',
      ].filter(Boolean);
      return final(
        [
          items.length
            ? `Open items by priority:\n${items.join('\n')}`
            : 'There are no open exceptions right now.',
          ...extra,
        ].join('\n'),
        'HIGH',
        { sources: ['ai_exception_queue', 'crm', 'approvals'] },
      );
    }

    case 'APPROVALS': {
      if (!last(r, 'getPendingApprovals')) return tool('getPendingApprovals');
      return final(
        'Pending approvals: {{getPendingApprovals.count}}.',
        'HIGH',
        { sources: ['approvals'] },
      );
    }

    case 'CREATE_TASK': {
      if (!can('createTask'))
        return final('I am not allowed to create tasks.', 'HIGH');
      const title =
        text
          .replace(
            /^.*?(?:create (?:a )?task(?: to| for)?|remind me to|add a task(?: to)?)\s*/i,
            '',
          )
          .trim() || 'Follow up';
      if (!last(r, 'createTask'))
        return tool('createTask', {
          title: title.slice(0, 180),
          relatedType: 'FOLLOW_UP',
        });
      return final(
        'Done — I created the task "{{createTask.title}}".',
        'HIGH',
        { sources: ['crm_tasks'] },
      );
    }

    case 'SUPPLIER': {
      if (!can('getSupplierStatus'))
        return final(
          'Supplier information is not available to me here.',
          'HIGH',
        );
      if (!last(r, 'getSupplierStatus')) return tool('getSupplierStatus');
      return final(
        'Provider failures in the last 24h: {{getSupplierStatus.providerFailuresLast24h}}. Contracts ending within 45 days: {{getSupplierStatus.contractsExpiringIn45Days}}.',
        'HIGH',
        { sources: ['supplier_contracts', 'provider_log'] },
      );
    }

    default:
      return {
        action: 'handoff',
        reason:
          'I could not understand the request well enough to answer reliably',
      };
  }
}

function planSupervisor(
  r: PlannerRequest,
  intent: Intent,
  can: (t: string) => boolean,
): ModelAction {
  const done = new Set((r.delegations ?? []).map((d) => d.agent));
  const t = r.objective.toLowerCase();
  const wanted: string[] = [];
  if (/pay|balance|owe|invoice|ledger|reconcil|finance/.test(t))
    wanted.push('finance_assistant');
  if (/visa/.test(t)) wanted.push('visa_ops');
  if (/hajj|umrah|pilgrim/.test(t)) wanted.push('hajj_ops');
  if (/flight|ticket|airline/.test(t)) wanted.push('flight_ops');
  if (/lead|follow|crm|quotation/.test(t)) wanted.push('crm_agent');
  if (/security|login|suspicious/.test(t)) wanted.push('security_agent');
  if (/revenue|sales|briefing|kpi/.test(t)) wanted.push('executive_assistant');
  void intent;
  void can;
  const next = wanted.find((a) => !done.has(a));
  if (next) return { action: 'delegate', agent: next, objective: r.objective };
  if (!wanted.length)
    return final(
      'I could not tell which team this belongs to; please add more detail.',
      'LOW',
      { needsInfo: true },
    );
  const lines = (r.delegations ?? []).map((d) => `• ${d.agent}: ${d.message}`);
  return final(
    `Here is what each specialist found:\n${lines.join('\n')}`,
    'MEDIUM',
    { sources: ['specialist_agents'] },
  );
}
