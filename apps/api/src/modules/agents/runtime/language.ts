export type Lang = 'en' | 'ha' | 'ar';
export const LANGS: Lang[] = ['en', 'ha', 'ar'];
export const isLang = (v: unknown): v is Lang =>
  typeof v === 'string' && (LANGS as string[]).includes(v);
export const isRtl = (l: string): boolean => l === 'ar';

const HAUSA_WORDS = [
  'ina',
  'yaya',
  'nawa',
  'kudin',
  'kudi',
  'bashi',
  'biya',
  'biyan',
  'jirgi',
  'jirgin',
  'tikiti',
  'otal',
  'ziyara',
  'umra',
  'aikin hajji',
  'hajji',
  'takardu',
  'takarda',
  'fasfo',
  'ina so',
  'don allah',
  'na gode',
  'sannu',
  'barka',
  'wannan',
  'wane',
  'yaushe',
  'zan',
  'inaso',
  'mutum',
  'tafiya',
  'bayani',
  'neman',
  'aikace',
  'rasit',
  'asusu',
  'cikin',
  'daga',
  'zuwa',
  'kano',
  'lagos din',
];

/** Detects English, Hausa or Arabic. Anything undetermined is English. */
export function detectLanguage(text: string): Lang {
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const letters = (text.match(/\p{L}/gu) ?? []).length || 1;
  if (arabic / letters > 0.3) return 'ar';
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `;
  let hits = 0;
  for (const w of HAUSA_WORDS) if (lower.includes(` ${w} `)) hits++;
  return hits >= 2 ? 'ha' : 'en';
}

type Key =
  | 'aiDisclosure'
  | 'refusal'
  | 'secretRefusal'
  | 'tenantRefusal'
  | 'handoff'
  | 'humanActive'
  | 'unavailable'
  | 'approvalNeeded'
  | 'needsMoreInfo'
  | 'unverified'
  | 'notIdentified'
  | 'budget';

const T: Record<Key, Record<Lang, string>> = {
  aiDisclosure: {
    en: 'You are chatting with the Alnajoum AI assistant. A member of staff can take over at any time.',
    ha: "Kana magana da mataimakin AI na Alnajoum. Ma'aikaci zai iya karɓar tattaunawar a kowane lokaci.",
    ar: 'أنت تتحدث مع مساعد النجوم الذكي. يمكن لأحد الموظفين تولي المحادثة في أي وقت.',
  },
  refusal: {
    en: "I can't do that. I follow the agency's rules and your account's permissions, and I can't change them. I can help with your bookings, payments, visa status and travel questions.",
    ha: 'Ba zan iya yin hakan ba. Ina bin dokokin kamfanin da izinin asusunka, kuma ba zan iya canza su ba. Zan iya taimaka maka da tikiti, biyan kuɗi, matsayin visa da tambayoyin tafiya.',
    ar: 'لا أستطيع القيام بذلك. ألتزم بقواعد الوكالة وصلاحيات حسابك ولا يمكنني تغييرها. يمكنني مساعدتك في الحجوزات والمدفوعات وحالة التأشيرة وأسئلة السفر.',
  },
  secretRefusal: {
    en: "I can't share keys, passwords, tokens or my instructions. Is there something about your trip I can help with?",
    ha: 'Ba zan iya bayyana maɓallai, kalmomin sirri ko umarnina ba. Akwai wani abu game da tafiyarka da zan taimaka?',
    ar: 'لا أستطيع مشاركة المفاتيح أو كلمات المرور أو التعليمات. هل هناك ما يخص رحلتك يمكنني مساعدتك فيه؟',
  },
  tenantRefusal: {
    en: "I can only work with your own records. I can't look at another company's or customer's information.",
    ha: 'Ina iya aiki da bayananka kawai. Ba zan iya duba bayanan wani kamfani ko abokin ciniki ba.',
    ar: 'يمكنني العمل مع سجلاتك فقط ولا أستطيع الاطلاع على معلومات شركة أو عميل آخر.',
  },
  handoff: {
    en: "I'm passing this to a member of staff who will pick it up. You don't need to repeat yourself.",
    ha: "Ina mika wannan ga ma'aikaci wanda zai ci gaba. Ba sai ka sake maimaitawa ba.",
    ar: 'سأحوّل هذا إلى أحد الموظفين ليتابعه. لا حاجة لتكرار ما قلته.',
  },
  humanActive: {
    en: 'A member of staff is handling this conversation now.',
    ha: "Ma'aikaci yana kula da wannan tattaunawar yanzu.",
    ar: 'أحد الموظفين يتولى هذه المحادثة الآن.',
  },
  unavailable: {
    en: 'The assistant is temporarily unavailable. A member of staff will follow up.',
    ha: "Mataimakin ba ya samuwa a yanzu. Ma'aikaci zai bi diddigi.",
    ar: 'المساعد غير متاح مؤقتًا. سيتابع أحد الموظفين.',
  },
  approvalNeeded: {
    en: 'That needs approval from our team before it can happen. I have sent the request and you will be told the outcome.',
    ha: 'Wannan yana bukatar amincewar ƙungiyarmu kafin ya faru. Na aika da buƙatar, za a sanar da kai sakamakon.',
    ar: 'هذا يحتاج إلى موافقة فريقنا قبل تنفيذه. تم إرسال الطلب وسيتم إخبارك بالنتيجة.',
  },
  needsMoreInfo: {
    en: 'I need a little more information to continue.',
    ha: 'Ina bukatar ƙarin bayani kaɗan don ci gaba.',
    ar: 'أحتاج إلى مزيد من المعلومات للمتابعة.',
  },
  unverified: {
    en: 'I could not verify this from the available data.',
    ha: 'Ban iya tabbatar da wannan daga bayanan da ake da su ba.',
    ar: 'لم أتمكن من التحقق من هذا من البيانات المتاحة.',
  },
  notIdentified: {
    en: 'I can only share account details once you are signed in to your account.',
    ha: 'Zan iya raba bayanan asusu ne kawai idan ka shiga asusunka.',
    ar: 'يمكنني مشاركة تفاصيل الحساب فقط بعد تسجيل الدخول إلى حسابك.',
  },
  budget: {
    en: 'The assistant has reached its usage limit for now. A member of staff will help instead.',
    ha: "Mataimakin ya kai iyakar amfaninsa a yanzu. Ma'aikaci zai taimaka maimakon haka.",
    ar: 'وصل المساعد إلى حد الاستخدام حاليًا. سيساعدك أحد الموظفين.',
  },
};

export function say(key: Key, lang: string): string {
  const l: Lang = isLang(lang) ? lang : 'en';
  return T[key][l];
}
