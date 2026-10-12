'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PublicApiError, publicRequest } from '@/lib/public-api';

interface Prefs {
  name: string;
  language: string;
  whatsapp: { address: string | null; status: string };
  email: { address: string | null; status: string };
  topics: { key: string; label: string }[];
  chosenTopics: string[];
  consentTextWhatsApp: string;
  consentTextEmail: string;
  privacyNoticeUrl: string | null;
  note: string;
}

const STATUS: Record<string, string> = {
  SUBSCRIBED: 'Subscribed',
  PENDING_CONFIRMATION: 'Waiting for your confirmation',
  UNSUBSCRIBED: 'Unsubscribed',
  NONE: 'Not subscribed',
};

/** The signed-out preference page opened from a link in a message. Addresses are shown masked. */
export default function PreferencesPage() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');

  const load = useCallback(() => {
    publicRequest<Prefs>('GET', `/public/comm/preferences/${encodeURIComponent(token)}`)
      .then((r) => {
        setP(r);
        setTopics(r.chosenTopics);
        setLanguage(r.language);
      })
      .catch((e) => setError(e instanceof PublicApiError && e.status === 404 ? 'This link is not valid any more.' : 'Could not load your preferences.'));
  }, [token]);
  useEffect(load, [load]);

  async function save(body: Record<string, unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await publicRequest<Prefs>('PUT', `/public/comm/preferences/${encodeURIComponent(token)}`, body);
      setP(r);
      setTopics(r.chosenTopics);
      setNotice(message);
    } catch (e) {
      setError(e instanceof PublicApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !p) return <main className="mx-auto max-w-md px-4 py-12"><p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p></main>;
  if (!p) return <main className="mx-auto max-w-md px-4 py-12"><p className="text-sm text-slate-500" role="status">Loading…</p></main>;

  const channels = [
    { key: 'whatsapp' as const, label: 'WhatsApp', data: p.whatsapp, field: 'whatsapp', text: p.consentTextWhatsApp },
    { key: 'email' as const, label: 'Email', data: p.email, field: 'emailMarketing', text: p.consentTextEmail },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Alnajoum Travel Agency</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Hello {p.name}, choose what you receive</h1>
      <p className="mt-2 text-sm text-slate-600">{p.note}</p>
      {notice && <p role="status" className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="mt-6 space-y-4">
        {channels.map((c) => {
          const on = c.data.status === 'SUBSCRIBED';
          return (
            <section key={c.key} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{c.label}</h2>
                  <p className="text-xs text-slate-500">{c.data.address ?? 'No address on file'}</p>
                  <p className="mt-1 text-xs font-medium text-slate-700">{STATUS[c.data.status] ?? c.data.status}</p>
                </div>
                {c.data.address && (
                  on ? (
                    <button disabled={busy} onClick={() => save({ [c.field]: false }, `${c.label} marketing is off. This took effect immediately.`)} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Turn off</button>
                  ) : c.data.status === 'PENDING_CONFIRMATION' ? (
                    <span className="text-xs text-slate-500">Check your {c.label === 'Email' ? 'inbox' : 'WhatsApp'}</span>
                  ) : (
                    <button disabled={busy} onClick={() => save({ [c.field]: true, topics }, `We have sent a confirmation to your ${c.label}. Nothing starts until you confirm.`)} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 disabled:opacity-50">Turn on</button>
                  )
                )}
              </div>
              {!on && c.data.address && c.data.status !== 'PENDING_CONFIRMATION' && <p className="mt-2 text-[11px] text-slate-400">{c.text}</p>}
            </section>
          );
        })}

        <section className="rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Topics</h2>
          <p className="text-xs text-slate-500">Leave all unticked to hear about everything we send.</p>
          <div className="mt-2 space-y-2">
            {p.topics.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={topics.includes(t.key)} onChange={(e) => setTopics((cur) => (e.target.checked ? [...cur, t.key] : cur.filter((x) => x !== t.key)))} />
                {t.label}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-3">
            <label className="block text-xs text-slate-600">Language
              <select className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option><option value="ha">Hausa</option><option value="ar">العربية</option>
              </select>
            </label>
            <button disabled={busy} onClick={() => save({ topics: topics, language, ...(p.email.status === 'SUBSCRIBED' ? { emailMarketing: true } : {}), ...(p.whatsapp.status === 'SUBSCRIBED' ? { whatsapp: true } : {}) }, 'Your choices are saved.')} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-800 disabled:opacity-50">Save</button>
          </div>
        </section>

        <section className="rounded-lg border border-red-200 bg-red-50/40 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Stop everything</h2>
          <p className="text-xs text-slate-600">Turns off WhatsApp and email marketing at once.</p>
          <button disabled={busy} onClick={() => save({ whatsapp: false, emailMarketing: false }, 'You are unsubscribed from all marketing.')} className="mt-2 rounded-md bg-red-700 px-3 py-1.5 text-xs text-white hover:bg-red-800 disabled:opacity-50">Unsubscribe from all</button>
        </section>
      </div>
      {p.privacyNoticeUrl && <p className="mt-6 text-xs text-slate-500"><a className="underline" href={p.privacyNoticeUrl} rel="noreferrer">Privacy notice</a></p>}
    </main>
  );
}
