'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  isEnabledByDefault: boolean;
  /** Override for the caller's own tenant if one exists, else the platform default. */
  isEnabled: boolean;
}

/**
 * Phase 11 spec #39. FeatureFlagsService.isEnabled() is now wired into a
 * real guard on every gated module (see FeatureFlagGuard) — this page is
 * how a Company Admin actually flips one for their own tenant, and how a
 * Super Admin reviews every flag's platform-wide default across tenants.
 * A flag is never a way around a permission check — turning one off just
 * hides/blocks the feature, it never grants anything a role wouldn't
 * otherwise have.
 */
export default function FeatureFlagsPage() {
  const { user } = useAuth();
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDefault, setNewDefault] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const isSuperAdmin = user?.roles.includes('SUPER_ADMIN') ?? false;
  const canManage = user?.permissions.includes('feature_flag:manage') ?? false;

  function load() {
    apiRequest<FeatureFlag[]>('/feature-flags')
      .then(setFlags)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  async function toggle(flag: FeatureFlag) {
    setError(null);
    setSavingKey(flag.key);
    try {
      if (flag.isEnabled === flag.isEnabledByDefault) {
        // No override yet — set one that flips the effective value.
        await apiRequest(`/feature-flags/${flag.key}/override`, {
          method: 'PUT',
          body: { isEnabled: !flag.isEnabled },
        });
      } else {
        // Already overridden — clear it back to the platform default.
        await apiRequest(`/feature-flags/${flag.key}/override`, { method: 'DELETE' });
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update flag');
    } finally {
      setSavingKey(null);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiRequest('/feature-flags', {
        method: 'POST',
        body: {
          key: newKey.trim().toUpperCase(),
          description: newDescription.trim() || undefined,
          isEnabledByDefault: newDefault,
        },
      });
      setNewKey('');
      setNewDescription('');
      setNewDefault(false);
      setCreateOpen(false);
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create flag');
    } finally {
      setCreating(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Feature Flags" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Feature Flags</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isSuperAdmin
                ? 'Platform-wide defaults, shown here without any tenant override applied.'
                : 'Toggling a flag here only affects your own company — other tenants keep the platform default.'}
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => setCreateOpen((v) => !v)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {createOpen ? 'Cancel' : 'Register new flag'}
            </button>
          )}
        </div>

        {createOpen && (
          <form
            onSubmit={handleCreate}
            className="mt-4 max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-4"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Key (SCREAMING_SNAKE_CASE)
              </label>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="ENABLE_SOMETHING"
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Description</label>
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={newDefault}
                onChange={(e) => setNewDefault(e.target.checked)}
              />
              Enabled by default (platform-wide)
            </label>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create flag'}
            </button>
          </form>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Key</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Description</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Platform default</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">
                  {isSuperAdmin ? 'Effective' : 'Your company'}
                </th>
                {!isSuperAdmin && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {flags?.map((flag) => {
                const overridden = flag.isEnabled !== flag.isEnabledByDefault;
                return (
                  <tr key={flag.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{flag.key}</td>
                    <td className="px-4 py-2 text-slate-600">{flag.description ?? '—'}</td>
                    <td className="px-4 py-2">
                      <StatusPill enabled={flag.isEnabledByDefault} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <StatusPill enabled={flag.isEnabled} />
                        {overridden && !isSuperAdmin && (
                          <span className="text-[11px] text-amber-700">overridden</span>
                        )}
                      </div>
                    </td>
                    {!isSuperAdmin && (
                      <td className="px-4 py-2 text-right">
                        {canManage && (
                          <button
                            onClick={() => toggle(flag)}
                            disabled={savingKey === flag.key}
                            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {savingKey === flag.key
                              ? 'Saving…'
                              : flag.isEnabled
                                ? 'Turn off'
                                : 'Turn on'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {flags?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    No feature flags registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        enabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {enabled ? 'On' : 'Off'}
    </span>
  );
}
