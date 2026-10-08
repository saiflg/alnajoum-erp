'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ApiError, apiRequest } from '@/lib/api';
import { PORTAL_NAV } from '@/lib/portal-nav';

type Lang = 'en' | 'ha' | 'ar';

interface Message {
  id: string;
  role: 'CUSTOMER' | 'AI' | 'STAFF' | 'SYSTEM';
  content: string;
  confidence?: string | null;
  sources?: { label: string }[] | null;
  createdAt?: string;
}
interface ConversationSummary {
  id: string;
  status: string;
  lastMessageAt: string;
}
interface ConversationDetail extends ConversationSummary {
  messages: Message[];
  aiDisclosure: string;
  language: string;
}

const T: Record<Lang, Record<string, string>> = {
  en: {
    title: 'AI Travel Assistant',
    subtitle: 'Ask about your bookings, payments, visa, documents or flights.',
    ai: 'AI assistant',
    staff: 'Staff member',
    placeholder: 'Type your question…',
    send: 'Send',
    person: 'Talk to a person',
    personDone: 'A member of staff will take over this conversation.',
    paused: 'A person is handling this conversation. The assistant will stay quiet until they hand it back.',
    newChat: 'New conversation',
    history: 'Your conversations',
    sources: 'Based on',
    verified: 'Checked against your records',
    unsure: 'Not fully verified',
    helpful: 'Helpful',
    wrong: 'Wrong',
    thanks: 'Thanks for the feedback',
    thinking: 'Checking your records…',
    language: 'Language',
    suggestions: 'Try asking',
  },
  ha: {
    title: 'Mataimakin Tafiya na AI',
    subtitle: 'Tambayi game da tikitinka, biyan kuɗi, visa, takardu ko jirgi.',
    ai: 'Mataimakin AI',
    staff: 'Ma\'aikaci',
    placeholder: 'Rubuta tambayarka…',
    send: 'Aika',
    person: 'Yi magana da mutum',
    personDone: 'Ma\'aikaci zai karɓi wannan tattaunawar.',
    paused: 'Mutum yana kula da wannan tattaunawar. Mataimakin zai yi shiru har sai ya mayar.',
    newChat: 'Sabuwar tattaunawa',
    history: 'Tattaunawarka',
    sources: 'Bisa ga',
    verified: 'An duba shi da bayananka',
    unsure: 'Ba a cika tabbatar ba',
    helpful: 'Ya taimaka',
    wrong: 'Ba daidai ba',
    thanks: 'Mun gode da ra\'ayinka',
    thinking: 'Ana duba bayananka…',
    language: 'Harshe',
    suggestions: 'Gwada tambaya',
  },
  ar: {
    title: 'مساعد السفر الذكي',
    subtitle: 'اسأل عن حجوزاتك ومدفوعاتك وتأشيرتك ومستنداتك ورحلاتك.',
    ai: 'مساعد ذكي',
    staff: 'موظف',
    placeholder: 'اكتب سؤالك…',
    send: 'إرسال',
    person: 'التحدث إلى شخص',
    personDone: 'سيتولى أحد الموظفين هذه المحادثة.',
    paused: 'أحد الموظفين يتولى هذه المحادثة. سيبقى المساعد صامتًا حتى يعيدها.',
    newChat: 'محادثة جديدة',
    history: 'محادثاتك',
    sources: 'استنادًا إلى',
    verified: 'تم التحقق من سجلاتك',
    unsure: 'غير مؤكد بالكامل',
    helpful: 'مفيد',
    wrong: 'خاطئ',
    thanks: 'شكرًا على ملاحظتك',
    thinking: 'جارٍ التحقق من سجلاتك…',
    language: 'اللغة',
    suggestions: 'جرّب أن تسأل',
  },
};

const PROMPTS: Record<Lang, string[]> = {
  en: ['How much do I owe?', 'Show my upcoming trips', 'What is my visa status? Which documents are missing?', 'Find me a flight from Kano to Jeddah on 10 October and return 20 October', 'Send me a payment link'],
  ha: ['Nawa nake bashi?', 'Nuna tafiye-tafiyena', 'Mene ne matsayin visa na?', 'Ina so in san takardun da suka ɓace'],
  ar: ['كم المبلغ المتبقي علي؟', 'اعرض رحلاتي القادمة', 'ما حالة تأشيرتي؟ ما المستندات الناقصة؟', 'أرسل لي رابط الدفع'],
};

const statusLabel = (s: string, t: Record<string, string>) => (s === 'PAUSED' || s === 'HUMAN_TAKEN' ? t.paused : '');

export default function AssistantPage() {
  const [lang, setLang] = useState<Lang>('en');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('AI_ACTIVE');
  const [disclosure, setDisclosure] = useState<string>('');
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<string, boolean>>({});
  const bottom = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const t = T[lang];
  const rtl = lang === 'ar';

  const refreshHistory = useCallback(() => {
    apiRequest<ConversationSummary[]>('/ai/assistant/conversations').then(setHistory).catch(() => undefined);
  }, []);
  useEffect(refreshHistory, [refreshHistory]);

  const open = useCallback(async (id: string) => {
    const c = await apiRequest<ConversationDetail>(`/ai/assistant/conversations/${id}`);
    setConversationId(c.id);
    setMessages(c.messages);
    setStatus(c.status);
    setDisclosure(c.aiDisclosure);
    if (c.language === 'en' || c.language === 'ha' || c.language === 'ar') setLang(c.language);
  }, []);

  // While a person has the conversation, pick up their replies.
  useEffect(() => {
    if (!conversationId || (status !== 'PAUSED' && status !== 'HUMAN_TAKEN')) return;
    const timer = setInterval(() => void open(conversationId).catch(() => undefined), 8000);
    return () => clearInterval(timer);
  }, [conversationId, status, open]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setInput('');
    const optimistic: Message = { id: `tmp-${++seq.current}`, role: 'CUSTOMER', content };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await apiRequest<{ conversationId: string; status: string; messages: Message[] }>('/ai/assistant/message', {
        method: 'POST',
        body: { content, conversationId: conversationId ?? undefined, language: lang },
      });
      setConversationId(r.conversationId);
      setStatus(r.status);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), ...r.messages]);
      refreshHistory();
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setError(err instanceof ApiError ? err.message : 'Could not reach the assistant');
    } finally {
      setBusy(false);
    }
  }

  async function requestPerson() {
    if (!conversationId) return;
    await apiRequest(`/ai/assistant/conversations/${conversationId}/human`, { method: 'POST' });
    setStatus('PAUSED');
    setMessages((m) => [...m, { id: `sys-${++seq.current}`, role: 'SYSTEM', content: t.personDone }]);
  }

  async function rate(id: string, rating: 'CORRECT' | 'INCORRECT') {
    await apiRequest('/ai/assistant/feedback', { method: 'POST', body: { messageId: id, rating } }).catch(() => undefined);
    setRated((r) => ({ ...r, [id]: true }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  const paused = status === 'PAUSED' || status === 'HUMAN_TAKEN';

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title={t.title} navLinks={PORTAL_NAV}>
        <div dir={rtl ? 'rtl' : 'ltr'} className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_16rem]">
          <section className="flex min-h-[32rem] flex-col rounded-xl border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t.title}</h2>
                <p className="text-xs text-slate-500">{t.subtitle}</p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                {t.language}
                <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-800">
                  <option value="en">English</option>
                  <option value="ha">Hausa</option>
                  <option value="ar">العربية</option>
                </select>
              </label>
            </header>

            <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="note">
              {disclosure || (lang === 'ar' ? 'أنت تتحدث مع مساعد ذكي. يمكن لأحد الموظفين تولي المحادثة في أي وقت.' : lang === 'ha' ? 'Kana magana da mataimakin AI. Ma\'aikaci zai iya karɓar tattaunawar a kowane lokaci.' : 'You are chatting with an AI assistant. A member of staff can take over at any time.')}
            </p>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {messages.length === 0 && (
                <div>
                  <p className="text-sm text-slate-500">{t.suggestions}:</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PROMPTS[lang].map((p) => (
                      <button key={p} type="button" onClick={() => void send(p)} className="rounded-full border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => {
                const mine = m.role === 'CUSTOMER';
                return (
                  <div key={m.id} className={`flex ${mine ? (rtl ? 'justify-start' : 'justify-end') : rtl ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-slate-900 text-white' : m.role === 'SYSTEM' ? 'bg-slate-100 text-slate-600' : 'border border-slate-200 bg-white text-slate-900'}`}>
                      {!mine && m.role !== 'SYSTEM' && (
                        <span className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${m.role === 'AI' ? 'bg-violet-100 text-violet-800' : 'bg-emerald-100 text-emerald-800'}`}>
                          {m.role === 'AI' ? t.ai : t.staff}
                        </span>
                      )}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.role === 'AI' && (
                        <div className="mt-2 space-y-1 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
                          {m.sources && m.sources.length > 0 && <p>{t.sources}: {m.sources.map((s) => s.label).join(' · ')}</p>}
                          <p>{m.confidence === 'HIGH' ? t.verified : t.unsure}</p>
                          {!m.id.startsWith('tmp') && (
                            <p className="flex gap-3">
                              {rated[m.id] ? (
                                <span>{t.thanks}</span>
                              ) : (
                                <>
                                  <button type="button" onClick={() => void rate(m.id, 'CORRECT')} className="hover:text-emerald-700">👍 {t.helpful}</button>
                                  <button type="button" onClick={() => void rate(m.id, 'INCORRECT')} className="hover:text-red-700">👎 {t.wrong}</button>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {busy && <p className="text-xs text-slate-400">{t.thinking}</p>}
              <div ref={bottom} />
            </div>

            {paused && <p className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">{statusLabel(status, t)}</p>}
            {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}

            <form onSubmit={onSubmit} className="flex gap-2 border-t border-slate-200 p-3">
              <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} placeholder={t.placeholder} aria-label={t.placeholder} className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
              <button type="submit" disabled={busy || !input.trim()} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">{t.send}</button>
              {conversationId && !paused && (
                <button type="button" onClick={() => void requestPerson()} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{t.person}</button>
              )}
            </form>
          </section>

          <aside className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{t.history}</h3>
              <button type="button" onClick={() => { setConversationId(null); setMessages([]); setStatus('AI_ACTIVE'); }} className="text-xs text-amber-700 hover:underline">{t.newChat}</button>
            </div>
            <ul className="mt-2 space-y-1">
              {history.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => void open(h.id)} className={`w-full rounded-md px-2 py-1.5 text-start text-xs hover:bg-slate-50 ${h.id === conversationId ? 'bg-slate-100 font-medium' : ''}`}>
                    {new Date(h.lastMessageAt).toLocaleString()}
                    {h.status !== 'AI_ACTIVE' && <span className="ms-1 text-slate-400">· {h.status.toLowerCase().replace('_', ' ')}</span>}
                  </button>
                </li>
              ))}
              {history.length === 0 && <li className="text-xs text-slate-400">—</li>}
            </ul>
          </aside>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
