'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PublicApiError, publicRequest } from '@/lib/public-api';

interface Info {
  company: string;
  topics: { key: string; label: string }[];
  textVersion: string;
  consentTextWhatsApp: string;
  consentTextEmail: string;
  privacyNoticeUrl: string | null;
}

const box = 'rounded-md border border-slate-300 px-3 py-2 text-sm w-full';

/**
 * The public subscription form. WhatsApp and email are asked for separately, each with its own unticked box and the
 * exact wording that will be stored as evidence. Nothing is pre-selected, and nothing starts until the person
 * confirms from the message we send.
 */
export default function SubscribePage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailOk, setEmailOk] = useState(false);
  const [waOk, setWaOk] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');
  const [trap, setTrap] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    publicRequest<Info>('GET', '/public/comm/subscribe-info')
      .then(setInfo)
      .catch(() => setLoadError('This sign-up form is not available right now.'));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      const r = await publicRequest<{ message: string }>('POST', '/public/comm/subscribe', {
        fullName: name,
        email: emailOk ? email : undefined,
        phone: waOk ? phone : undefined,
        emailMarketing: emailOk,
        whatsapp: waOk,
        topics,
        language,
        textVersion: info.textVersion,
        website: trap || undefined,
      });
      setDone(r.message);
    } catch (err) {
      setError(err instanceof PublicApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">{info?.company ?? 'Alnajoum Travel Agency'}</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Travel offers and updates</h1>
        <p className="mt-2 text-sm text-slate-600">
          Choose how you would like to hear from us. Every box starts empty; we only contact you the way you tick below, and only after you confirm.
          Messages about your own bookings and payments are separate and are not affected.
        </p>
      </header>

      {loadError && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{loadError}</p>}
      {!info && !loadError && <p className="text-sm text-slate-500" role="status">Loading…</p>}

      {done ? (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Almost done</p>
          <p className="mt-1">{done}</p>
        </div>
      ) : (
        info && (
          <form onSubmit={submit} className="space-y-5">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Your name</span>
              <input className={box} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
            </label>

            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">Email</legend>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Email address</span>
                <input className={box} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} />
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input className="mt-1" type="checkbox" checked={emailOk} onChange={(e) => setEmailOk(e.target.checked)} />
                <span>{info.consentTextEmail}</span>
              </label>
            </fieldset>

            <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">WhatsApp</legend>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">WhatsApp number (with country code if outside Nigeria)</span>
                <input className={box} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={40} />
              </label>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input className="mt-1" type="checkbox" checked={waOk} onChange={(e) => setWaOk(e.target.checked)} />
                <span>{info.consentTextWhatsApp}</span>
              </label>
            </fieldset>

            <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-800">What are you interested in? (optional)</legend>
              <p className="text-xs text-slate-500">Leave all unticked to hear about everything we send.</p>
              {info.topics.map((t) => (
                <label key={t.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={topics.includes(t.key)} onChange={(e) => setTopics((cur) => (e.target.checked ? [...cur, t.key] : cur.filter((x) => x !== t.key)))} />
                  {t.label}
                </label>
              ))}
            </fieldset>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Language</span>
              <select className={box} value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="en">English</option>
                <option value="ha">Hausa</option>
                <option value="ar">العربية (Arabic)</option>
              </select>
            </label>

            {/* Hidden from people; a bot that fills every field fills this one too. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>Website<input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} /></label>
            </div>

            {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

            <button disabled={busy || (!emailOk && !waOk)} className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {busy ? 'Sending…' : 'Subscribe'}
            </button>
            {!emailOk && !waOk && <p className="text-xs text-slate-500">Tick at least one box above to subscribe.</p>}
            <p className="text-xs text-slate-500">
              We will send you a message to confirm. You can unsubscribe at any time using the link in every email, by replying STOP on WhatsApp, or from your preferences page.
              {info.privacyNoticeUrl && (
                <>
                  {' '}
                  <a className="underline" href={info.privacyNoticeUrl} rel="noreferrer">Read our privacy notice</a>.
                </>
              )}
            </p>
          </form>
        )
      )}
    </main>
  );
}
