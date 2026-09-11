'use client';

import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';

interface SystemSetting {
  id: string;
  companyId: string | null;
  category: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

interface SettingHistoryEntry {
  id: string;
  previousValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: string;
}

// Categories the platform ships settings under so far — spec #20's
// "cross-cutting configuration with no other home" (SECURITY: password
// policy/lockout thresholds; APPROVALS/GENERAL: everything else). Not an
// enum on the backend — @Get(':category') accepts any string — so a
// custom one can still be typed into "Other".
const KNOWN_CATEGORIES = ['SECURITY', 'GENERAL', 'NOTIFICATIONS'];

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Best-effort: numbers/booleans/objects round-trip through JSON.parse;
 * anything that fails to parse is kept as the literal string typed in. */
function parseValueInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export default function SystemSettingsPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState(KNOWN_CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [settings, setSettings] = useState<SystemSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<SettingHistoryEntry[] | null>(null);

  const [formKey, setFormKey] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formReason, setFormReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canEdit = user?.permissions.includes('settings:edit') ?? false;
  const effectiveCategory = category === '__other__' ? customCategory.trim() : category;

  function load() {
    if (!effectiveCategory) return;
    apiRequest<SystemSetting[]>(`/system-settings/${effectiveCategory}`)
      .then(setSettings)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }

  useEffect(load, [effectiveCategory]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!effectiveCategory || !formKey.trim()) return;
    setFormError(null);
    setSaving(true);
    try {
      await apiRequest(`/system-settings/${effectiveCategory}/${formKey.trim()}`, {
        method: 'PUT',
        body: { value: parseValueInput(formValue), reason: formReason.trim() || undefined },
      });
      setFormKey('');
      setFormValue('');
      setFormReason('');
      load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save setting');
    } finally {
      setSaving(false);
    }
  }

  async function viewHistory(setting: SystemSetting) {
    setHistoryFor(setting.id);
    setHistory(null);
    try {
      const rows = await apiRequest<SettingHistoryEntry[]>(
        `/system-settings/history/${setting.id}`,
      );
      setHistory(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load history');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="System Settings" navLinks={ADMIN_NAV}>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">System Settings</h2>
          <p className="mt-1 text-sm text-slate-500">
            Database-backed configuration, versioned on every change. A
            tenant&apos;s own value overrides the platform-wide default for the
            same category/key.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          >
            {KNOWN_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__other__">Other…</option>
          </select>
          {category === '__other__' && (
            <input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="Category name"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Key</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Value</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Scope</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Updated</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {settings?.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{s.key}</td>
                  <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-slate-600">
                    {displayValue(s.value)}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {s.companyId ? 'Your company' : 'Platform default'}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {formatDateTime(s.updatedAt)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => viewHistory(s)}
                      className="text-xs font-medium text-amber-700 hover:underline"
                    >
                      History
                    </button>
                  </td>
                </tr>
              ))}
              {settings?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                    No settings recorded for this category yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {historyFor && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Change history</h3>
              <button
                onClick={() => setHistoryFor(null)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>
            {history === null && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
            <ul className="mt-2 space-y-2 text-xs text-slate-600">
              {history?.map((h) => (
                <li key={h.id} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                  <span className="font-mono">{displayValue(h.previousValue)}</span>
                  {' → '}
                  <span className="font-mono">{displayValue(h.newValue)}</span>
                  {h.reason && <span className="text-slate-400"> — {h.reason}</span>}
                  <div className="text-[11px] text-slate-400">{formatDateTime(h.createdAt)}</div>
                </li>
              ))}
              {history?.length === 0 && <li>No changes recorded yet.</li>}
            </ul>
          </div>
        )}

        {canEdit && effectiveCategory && (
          <form
            onSubmit={handleSave}
            className="mt-6 max-w-lg space-y-3 rounded-lg border border-slate-200 bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-slate-900">
              Set a value in {effectiveCategory}
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-600">Key</label>
              <input
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Value (plain text, or JSON for a number/object/array)
              </label>
              <textarea
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                rows={2}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Reason (recorded in history)
              </label>
              <input
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save setting'}
            </button>
          </form>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
