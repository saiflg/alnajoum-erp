'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { IntegrationCategory, IntegrationProvider } from '@/lib/types';

const CATEGORIES: { key: IntegrationCategory; label: string; blurb: string }[] = [
  {
    key: 'FLIGHT',
    label: 'Flights',
    blurb: 'Search and booking provider for the flight search page.',
  },
  {
    key: 'PAYMENT',
    label: 'Payments',
    blurb: 'Hosted checkout provider for online invoice payments.',
  },
  {
    key: 'NOTIFICATION',
    label: 'Email & SMS',
    blurb: 'Outbound email delivery for receipts, reminders, and confirmations.',
  },
];

function ProviderCard({
  category,
  provider,
  onChanged,
}: {
  category: IntegrationCategory;
  provider: IntegrationProvider;
  onChanged: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    // Only send fields the admin actually typed something into — leaves
    // already-saved fields (e.g. a secret they're not rotating) untouched,
    // since the API merges rather than overwrites.
    const changed = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim() !== ''),
    );
    if (Object.keys(changed).length === 0) {
      setError('Enter at least one value to save.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest(`/integrations/${category}/${provider.provider}`, {
        method: 'PATCH',
        body: { config: changed },
      });
      setValues({});
      setMessage('Saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    setError(null);
    setMessage(null);
    setActivating(true);
    try {
      await apiRequest(`/integrations/${category}/${provider.provider}/activate`, {
        method: 'PATCH',
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to activate');
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">{provider.label}</h3>
            {provider.isActive && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Active
              </span>
            )}
            {!provider.implemented && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                Not yet implemented
              </span>
            )}
          </div>
          {provider.docsUrl && (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-block text-xs text-amber-700 hover:underline"
            >
              {provider.docsUrl}
            </a>
          )}
          {provider.updatedAt && (
            <p className="mt-0.5 text-xs text-slate-400">
              Last updated {new Date(provider.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
        {!provider.isActive && (
          <button
            onClick={handleActivate}
            disabled={activating}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {activating ? 'Activating…' : 'Set as active'}
          </button>
        )}
      </div>

      {provider.fields.length > 0 && (
        <form onSubmit={handleSave} className="mt-4 space-y-3">
          {provider.fields.map((field) => {
            const isSaved = provider.configuredFields.includes(field.key);
            return (
              <div key={field.key}>
                <label className="block text-xs font-medium text-slate-600">
                  {field.label}
                  {isSaved && (
                    <span className="ml-2 text-[11px] font-normal text-emerald-600">
                      configured
                    </span>
                  )}
                </label>
                <input
                  type={field.secret ? 'password' : 'text'}
                  value={values[field.key] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={
                    isSaved ? '•••••••• (leave blank to keep)' : field.placeholder
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            );
          })}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {message && <p className="text-xs text-emerald-600">{message}</p>}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save credentials'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  const [category, setCategory] = useState<IntegrationCategory>('FLIGHT');
  const [providers, setProviders] = useState<IntegrationProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiRequest<IntegrationProvider[]>(`/integrations/${category}`)
      .then(setProviders)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [category]);

  const activeCategory = CATEGORIES.find((c) => c.key === category)!;

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Integrations" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Integrations</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Add real API credentials for third-party providers, then activate the one
          you want live — takes effect immediately, no server restart. Credentials are
          write-only: once saved, the actual value is never shown again, only whether
          it&apos;s configured.
        </p>

        <div className="mt-5 flex gap-1 border-b border-slate-200">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${
                category === c.key
                  ? 'border-amber-500 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-500">{activeCategory.blurb}</p>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 space-y-4">
          {providers?.map((p) => (
            <ProviderCard key={p.provider} category={category} provider={p} onChanged={load} />
          ))}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
