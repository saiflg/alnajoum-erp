'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV, FINANCE_NAV } from '@/lib/admin-nav';
import { apiFileUrl, apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

/**
 * Self-service "change my own password" page for any authenticated staff
 * role, including the bootstrap Super Admin — there was previously no
 * frontend for the existing PATCH /auth/change-password endpoint at all.
 */
export default function StaffAccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const navLinks =
    user?.roles.includes('FINANCE_OFFICER') && user.roles.length === 1
      ? FINANCE_NAV
      : ADMIN_NAV;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'PATCH',
        body: { currentPassword, newPassword },
      });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ProtectedRoute
      allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF']}
    >
      <AppShell title="My Account" navLinks={navLinks}>
        <h2 className="text-lg font-semibold text-slate-900">My Account</h2>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {user?.email}
        </p>

        <div className="mt-6 max-w-md rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-900">Change Password</h3>
          <p className="mt-1 text-xs text-slate-500">
            Use a password you haven&apos;t used anywhere else. At least 8 characters, with at
            least one letter and one number.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Current password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">New password</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Confirm new password
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && (
              <p className="text-sm text-emerald-600">
                Password changed successfully.
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Changing…' : 'Change Password'}
            </button>
          </form>
        </div>

        <div className="mt-6 max-w-md rounded-lg border border-slate-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-slate-900">My ID Card</h3>
          <p className="mt-1 text-xs text-slate-500">
            A printable staff badge with a QR code anyone can scan to confirm
            you&apos;re a current Alnajoum Travel Agency employee.
          </p>
          <a
            href={apiFileUrl('/staff/me/id-card')}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            View / Print ID Card
          </a>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <TwoFactorSection />
          <SessionsSection />
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/**
 * Phase 11 spec #15 — self-service 2FA. There was no frontend for
 * /auth/2fa/* at all before this; every one of these endpoints already
 * worked, they just had nowhere to be clicked from.
 */
function TwoFactorSection() {
  const { user, refreshUser } = useAuth();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  async function beginSetup() {
    setError(null);
    setBusy(true);
    try {
      const result = await apiRequest<TwoFactorSetup>('/auth/2fa/setup', { method: 'POST' });
      setSetup(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start setup');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>('/auth/2fa/verify-enable', {
        method: 'POST',
        body: { code },
      });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest('/auth/2fa/disable', { method: 'POST', body: { code } });
      setCode('');
      setConfirmingDisable(false);
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCodes(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>(
        '/auth/2fa/recovery-codes/regenerate',
        { method: 'POST', body: { code } },
      );
      setRecoveryCodes(result.recoveryCodes);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Two-Factor Authentication</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            user?.twoFactorEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Adds an authenticator-app code to every login, plus one-time recovery
        codes if you lose the device.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {recoveryCodes && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">
            Save these recovery codes — each works once, and they won&apos;t be shown again.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-slate-800">
            {recoveryCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button
            onClick={() => setRecoveryCodes(null)}
            className="mt-2 text-xs text-amber-700 hover:underline"
          >
            I&apos;ve saved them
          </button>
        </div>
      )}

      {!user?.twoFactorEnabled && !setup && (
        <button
          onClick={beginSetup}
          disabled={busy}
          className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Enable 2FA'}
        </button>
      )}

      {setup && (
        <form onSubmit={confirmEnable} className="mt-4 space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated server-side per request, not a static/optimizable asset */}
          <img src={setup.qrCodeDataUrl} alt="Scan with your authenticator app" className="h-40 w-40" />
          <p className="text-xs text-slate-500">
            Can&apos;t scan?{' '}
            <code className="break-all rounded bg-slate-100 px-1 py-0.5">{setup.secret}</code>
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Enter the 6-digit code from your app
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Confirm & enable'}
          </button>
        </form>
      )}

      {user?.twoFactorEnabled && (
        <div className="mt-4 space-y-3">
          <form onSubmit={regenerateCodes} className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Authenticator or recovery code
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Regenerate recovery codes
            </button>
          </form>

          {!confirmingDisable ? (
            <button
              onClick={() => setConfirmingDisable(true)}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Disable 2FA
            </button>
          ) : (
            <form onSubmit={disable} className="flex items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Confirm with a code to disable
                </label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="mt-1 w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Disable
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDisable(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  expiresAt: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  isCurrent: boolean;
}

/** Phase 11 spec #16 — self-service session management: see every device
 * currently (or previously) signed in as you, and revoke one or all of
 * the others without touching the session you're using right now. */
function SessionsSection() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  function load() {
    apiRequest<SessionRow[]>('/auth/sessions')
      .then(setSessions)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sessions'));
  }

  useEffect(load, []);

  async function revoke(id: string) {
    setActingId(id);
    try {
      await apiRequest(`/auth/sessions/${id}/revoke`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke session');
    } finally {
      setActingId(null);
    }
  }

  async function revokeOthers() {
    setActingId('__others__');
    try {
      await apiRequest('/auth/sessions/revoke-others', { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke other sessions');
    } finally {
      setActingId(null);
    }
  }

  const hasOtherActive = sessions?.some((s) => !s.isCurrent && s.status === 'ACTIVE') ?? false;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Active Sessions</h3>
        {hasOtherActive && (
          <button
            onClick={revokeOthers}
            disabled={actingId === '__others__'}
            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
          >
            {actingId === '__others__' ? 'Revoking…' : 'Revoke all other sessions'}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <ul className="mt-3 space-y-2">
        {sessions?.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm"
          >
            <div>
              <p className="text-slate-700">
                {s.userAgent ?? 'Unknown device'}
                {s.isCurrent && (
                  <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    This device
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400">
                {s.ipAddress ?? 'Unknown IP'} · last active{' '}
                {s.lastActivityAt ? formatDateTime(s.lastActivityAt) : 'never'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {s.status}
              </span>
              {!s.isCurrent && s.status === 'ACTIVE' && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={actingId === s.id}
                  className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </div>
          </li>
        ))}
        {sessions?.length === 0 && (
          <li className="text-sm text-slate-500">No sessions found.</li>
        )}
      </ul>
    </div>
  );
}
