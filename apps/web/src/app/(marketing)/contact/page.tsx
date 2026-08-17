'use client';

import { FormEvent, useState } from 'react';
import { Reveal } from '@/components/marketing/Reveal';
import { apiRequest, ApiError } from '@/lib/api';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/contact', {
        method: 'POST',
        body: { name, email, subject, message },
      });
      setSent(true);
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send your message');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Get in touch
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">
          Questions about a booking, a package, or the platform itself — send us a
          message and it goes straight to our team.
        </p>
      </Reveal>

      <Reveal delay={0.1} className="mt-14">
        <div className="grid gap-10 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:grid-cols-5">
          <div className="sm:col-span-2">
            <h2 className="text-sm font-semibold text-slate-900">Contact details</h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li>alnajoumtravelagency@gmail.com</li>
              <li>0814 190 6416</li>
              <li>Kankia Street, Unguwar Sarki, Kaduna, Kaduna State</li>
            </ul>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:col-span-3">
            {sent ? (
              <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">
                Thanks — your message has been sent. We&apos;ll get back to you soon.
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Name</label>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Email</label>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Subject</label>
                  <input
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Message</label>
                  <textarea
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Send message'}
                </button>
              </>
            )}
          </form>
        </div>
      </Reveal>
    </div>
  );
}
