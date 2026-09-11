'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Phase 11 spec #16 — an identity's own API keys, scoped to whatever
 * subset of their own permissions they choose to grant the key (never
 * more than the identity already holds — enforced server-side). The
 * plaintext key is shown exactly once, right after creation; only the
 * prefix is ever stored/displayed afterwards.
 */
export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreatedSecret, setJustCreatedSecret] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function load() {
    apiRequest<ApiKey[]>('/api-keys')
      .then(setKeys)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const result = await apiRequest<{ rawKey: string }>('/api-keys', {
        method: 'POST',
        body: {
          name: name.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
      });
      setJustCreatedSecret(result.rawKey);
      setName('');
      setExpiresAt('');
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await apiRequest(`/api-keys/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to revoke key');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <ProtectedRoute
      allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF']}
    >
      <AppShell title="API Keys" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">My API Keys</h2>
        <p className="mt-1 text-sm text-slate-500">
          For scripts and integrations acting as you. Each key can never do
          more than your own account already can.
        </p>

        {justCreatedSecret && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">
              Copy this key now — it won&apos;t be shown again.
            </p>
            <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-sm text-slate-900">
              {justCreatedSecret}
            </code>
            <button
              onClick={() => setJustCreatedSecret(null)}
              className="mt-2 text-xs text-amber-700 hover:underline"
            >
              I&apos;ve saved it
            </button>
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Reporting script"
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Expires (optional)
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </form>
        {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Name</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Prefix</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Last used</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Expires</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {keys?.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-2 text-slate-700">{k.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{k.keyPrefix}…</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'Never'}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {k.expiresAt ? formatDateTime(k.expiresAt) : 'Never'}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        k.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {k.status === 'ACTIVE' ? 'Active' : k.status === 'EXPIRED' ? 'Expired' : 'Revoked'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {k.status === 'ACTIVE' && (
                      <button
                        onClick={() => revoke(k.id)}
                        disabled={revokingId === k.id}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {keys?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No API keys yet.
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
