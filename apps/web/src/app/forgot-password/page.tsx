'use client';

import { AuthSplit } from '@/components/visual/AuthSplit';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { ApiError, apiRequest } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest('/auth/forgot-password', { method: 'POST', body: { email }, retryOn401: false });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplit>
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <BrandMark size={32} />
          <h1 className="text-xl font-semibold text-slate-900">Reset your password</h1>
        </div>
        {sent ? (
          <div className="mt-6 space-y-4 text-sm text-slate-600">
            <p>
              If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 30
              minutes and can be used once.
            </p>
            <Link href="/login" className="text-slate-900 underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <p className="text-sm text-slate-500">Enter your email and we will send you a link to choose a new password.</p>
            <div>
              <label className="block text-sm font-medium text-slate-700" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <p className="text-center text-sm">
              <Link href="/login" className="text-slate-500 hover:text-slate-700">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </AuthSplit>
  );
}
