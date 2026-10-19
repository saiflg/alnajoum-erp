'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { ApiError, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * Shown to anyone who signed in with a temporary password an administrator gave them. Until they choose their own,
 * the server refuses everything else, so this page is the only way forward.
 */
export default function ChangePasswordPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (!user.mustChangePassword) router.replace(user.dashboardPath);
  }, [loading, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError('The two new passwords do not match.');
    if (newPassword === currentPassword) return setError('Choose a password different from the temporary one.');
    setSubmitting(true);
    try {
      await apiRequest('/auth/change-password', { method: 'PATCH', body: { currentPassword, newPassword } });
      // Changing the password ends every session, so sign in again with the new one.
      await logout();
      router.replace('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The password could not be changed.');
      setSubmitting(false);
    }
  }

  if (loading || !user?.mustChangePassword) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  const field = 'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none';
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BrandMark />
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Choose your own password</h1>
          <p className="mt-1 text-sm text-slate-600">
            You signed in with a temporary password an administrator gave you. Choose a new one that only you know. You will then sign in again.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">Temporary password</span>
          <input className={field} type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">New password</span>
          <input className={field} type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <span className="mt-1 block text-[11px] text-slate-400">At least 8 characters, with a letter and a number.</span>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-slate-600">New password again</span>
          <input className={field} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button disabled={submitting} className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
          {submitting ? 'Saving…' : 'Save my new password'}
        </button>
      </form>
    </div>
  );
}
