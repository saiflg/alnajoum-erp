/**
 * Reads what a WhatsApp reply means for consent. English, Hausa and Arabic. The aim is to be sure when it is sure
 * ("STOP", "unsubscribe", "daina", "إيقاف") and to ask when it is not ("cancel", "no", "stop" alone in a short
 * message) - never to unsubscribe someone who was cancelling a ticket, and never to ignore a clear request.
 */
export type ConsentIntent =
  'OPT_OUT' | 'OPT_OUT_UNCLEAR' | 'OPT_IN' | 'CONFIRM' | 'OTHER';

function clean(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      // strip Arabic diacritics and tatweel, and unify alef forms, so spelling variants compare equal
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const OPT_OUT_EXACT = new Set([
  'stop',
  'stop all',
  'unsubscribe',
  'unsub',
  'opt out',
  'optout',
  'quit',
  'end',
  'daina',
  'dakata',
  'ka daina',
  'a daina',
  'cire ni',
  'ايقاف',
  'توقف',
  'الغاء الاشتراك',
  'الغاء الاشتراك من الرسائل',
  'ايقاف الاشتراك',
]);

const OPT_OUT_PHRASES = [
  'stop messaging',
  'stop messages',
  'stop sending',
  'stop texting',
  'unsubscribe me',
  'remove me',
  'take me off',
  'do not message',
  'dont message',
  'do not contact',
  'dont contact',
  'no more messages',
  'opt me out',
  'daina aiko',
  'ka daina aiko',
  'cire ni daga',
  'bana son sakonni',
  'ba na son sakonni',
  'bana so a rika aiko',
  'لا ترسل',
  'لا ترسلوا',
  'توقفوا عن',
  'توقف عن ارسال',
  'الغاء الاشتراك',
  'ايقاف الرسائل',
  'احذفني',
];

// Deliberately explicit: a bare "yes" or "ok" is an answer to something else, not a request to be marketed to.
const OPT_IN_EXACT = new Set([
  'start',
  'subscribe',
  'opt in',
  'optin',
  'fara',
  'اشترك',
  'ابدا',
]);
const CONFIRM_EXACT = new Set([
  'confirm',
  'yes confirm',
  'ok confirm',
  'tabbatar',
  'تاكيد',
  'اؤكد',
]);

// Words that show the person is talking about a booking, not about marketing.
const BOOKING_WORDS = [
  'booking',
  'ticket',
  'flight',
  'visa',
  'hotel',
  'payment',
  'refund',
  'reservation',
  'order',
  'trip',
  'tikiti',
  'jirgi',
  'biza',
  'kudi',
  'حجز',
  'تذكره',
  'رحله',
  'تاشيره',
  'استرداد',
  'دفع',
];
// Words that might be a request to stop but might be about something else.
const AMBIGUOUS_WORDS = [
  'stop',
  'cancel',
  'no',
  'end',
  'enough',
  'daina',
  'dakata',
  'لا',
  'الغاء',
  'توقف',
  'ايقاف',
];

export function classifyConsentReply(text: string): ConsentIntent {
  const t = clean(text);
  if (!t) return 'OTHER';
  if (OPT_OUT_EXACT.has(t)) return 'OPT_OUT';
  if (CONFIRM_EXACT.has(t)) return 'CONFIRM';
  if (OPT_IN_EXACT.has(t)) return 'OPT_IN';

  // "please stop sending me messages about umrah" is a clear opt-out even though it names a product.
  if (OPT_OUT_PHRASES.some((p) => t.includes(p))) return 'OPT_OUT';
  // "cancel my booking" / "stop the payment" are about the booking, not about marketing.
  if (BOOKING_WORDS.some((w) => t.includes(w))) return 'OTHER';
  // Short, with a stop-like word and no other context: ask rather than guess.
  const words = t.split(' ');
  if (words.length <= 4 && words.some((w) => AMBIGUOUS_WORDS.includes(w)))
    return 'OPT_OUT_UNCLEAR';
  return 'OTHER';
}

export const CLARIFICATION: Record<'en' | 'ha' | 'ar', string> = {
  en: 'Do you want to stop receiving promotional messages from us? Reply STOP to unsubscribe. Messages about your bookings will continue.',
  ha: 'Kana so ka daina karɓar saƙonnin talla daga gare mu? Ka amsa STOP don ficewa. Saƙonnin da suka shafi tafiyarka za su ci gaba.',
  ar: 'هل تريد التوقف عن تلقي رسائلنا الترويجية؟ أرسل STOP لإلغاء الاشتراك. ستستمر رسائل حجوزاتك.',
};

export const OPT_OUT_ACK: Record<'en' | 'ha' | 'ar', string> = {
  en: 'You have been unsubscribed from promotional WhatsApp messages. You will still receive messages about your own bookings. Reply START to subscribe again.',
  ha: 'An cire ka daga saƙonnin talla na WhatsApp. Za ka ci gaba da karɓar saƙonni game da tafiyarka. Ka amsa START don sake shiga.',
  ar: 'تم إلغاء اشتراكك في الرسائل الترويجية على واتساب. ستصلك رسائل حجوزاتك. أرسل START للاشتراك من جديد.',
};

// ------------------------------------------------------------------------------------------------ enquiries

export type EnquiryIntent =
  | 'PACKAGE'
  | 'FLIGHT'
  | 'VISA'
  | 'HAJJ_UMRAH'
  | 'BOOKING_STATUS'
  | 'HUMAN'
  | 'FAQ'
  | 'OTHER';

const ENQUIRY_WORDS: [EnquiryIntent, string[]][] = [
  [
    'HUMAN',
    [
      'agent',
      'human',
      'person',
      'staff',
      'someone',
      'call me',
      'speak to',
      'talk to',
      'mutum',
      'wakili',
      'kira ni',
      'موظف',
      'شخص',
      'اتصل',
    ],
  ],
  [
    'BOOKING_STATUS',
    [
      'my booking',
      'booking status',
      'reservation',
      'my ticket',
      'status of',
      'hajina',
      'matsayin',
      'حجزي',
      'حالة الحجز',
    ],
  ],
  ['HAJJ_UMRAH', ['hajj', 'umrah', 'umra', 'hajji', 'حج', 'عمرة', 'عمره']],
  ['VISA', ['visa', 'biza', 'تأشيرة', 'تاشيرة', 'فيزا']],
  [
    'FLIGHT',
    [
      'flight',
      'flights',
      'ticket',
      'airline',
      'jirgi',
      'tikiti',
      'رحلة',
      'رحله',
      'تذكرة',
      'تذكره',
    ],
  ],
  [
    'PACKAGE',
    [
      'package',
      'price',
      'how much',
      'cost',
      'kudin',
      'farashi',
      'nawa ne',
      'باقة',
      'سعر',
      'كم',
    ],
  ],
  [
    'FAQ',
    [
      'office',
      'address',
      'opening',
      'hours',
      'where are you',
      'ofis',
      'adireshi',
      'عنوان',
      'ساعات',
    ],
  ],
];

/**
 * A coarse reading of what an enquiry is about, used to route and to report - never to answer. The system does not
 * quote prices, availability, visa outcomes or booking or payment status from a guess; those come from the live
 * records (for a verified customer) or from a person.
 */
export function classifyEnquiry(text: string): {
  intent: EnquiryIntent;
  confidence: 'HIGH' | 'LOW';
} {
  const t = clean(text);
  if (!t) return { intent: 'OTHER', confidence: 'LOW' };
  const hits = ENQUIRY_WORDS.filter(([, words]) =>
    words.some((w) => t.includes(clean(w))),
  );
  if (hits.length === 0) return { intent: 'OTHER', confidence: 'LOW' };
  return { intent: hits[0][0], confidence: hits.length === 1 ? 'HIGH' : 'LOW' };
}

/** Which of the three supported languages a short message is probably in. */
export function guessLanguage(text: string): 'en' | 'ha' | 'ar' {
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (
    /\b(daina|dakata|sannu|na gode|kudin|farashi|jirgi|tikiti|biza|mutum|bana|ba na)\b/i.test(
      text,
    )
  )
    return 'ha';
  return 'en';
}
