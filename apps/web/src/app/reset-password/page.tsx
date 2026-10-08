'use client';

import { AuthSplit } from '@/components/visual/AuthSplit';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { ApiError, apiRequest } from '@/lib/api';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
        retryOn401: false,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <p className="mt-6 text-sm text-slate-600">
        This reset link is incomplete. Please use the link from your email, or{' '}
        <Link href="/forgot-password" className="underline">
          request a new one
        </Link>
        .
      </p>
    );
  }

  if (done) {
    return (
      <div className="mt-6 space-y-4 text-sm text-slate-600">
        <p>Your password has been changed and every other session was signed out.</p>
        <Link href="/login" className="text-slate-900 underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="password">
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">At least 8 characters, with a letter and a number.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700" htmlFor="confirm">
          Confirm new password
        </label>
        <input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthSplit>
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <BrandMark size={32} />
          <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
        </div>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </AuthSplit>
  );
}
