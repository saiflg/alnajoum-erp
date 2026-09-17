'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiFileUrl, apiRequest, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Phase 11's "backup management" — a real pg_dump an admin can download
 * and store off-server. Deliberately create/download/delete only, no
 * restore action: see BackupService's own doc comment for why (no
 * maintenance mode to drain connections yet, no confirmation flow harder
 * to misfire than one click, nowhere to verify a restored dump before
 * it's live). Platform-wide, not tenant-scoped — a dump contains every
 * tenant's data — so this page is Super Admin only.
 */
export default function BackupsPage() {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);

  function load() {
    apiRequest<BackupInfo[]>('/backups')
      .then(setBackups)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load backups'));
  }

  useEffect(load, []);

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      await apiRequest('/backups', { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(filename: string) {
    if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
    setDeletingFilename(filename);
    try {
      await apiRequest(`/backups/${filename}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete backup');
    } finally {
      setDeletingFilename(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
      <AppShell title="Backup Management" navLinks={ADMIN_NAV}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Backup Management</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              A full database snapshot, platform-wide across every tenant. Download
              and store a copy off-server. There is no restore action here — safely
              restoring a live database needs infrastructure this platform doesn&apos;t
              have yet (a maintenance window, a confirmation flow harder to misfire
              than one click, somewhere to verify the data first) — so treat these as
              an offline safety net, not a one-click undo.
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="shrink-0 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Backup'}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Filename</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Size</th>
                <th className="px-4 py-2 text-left font-medium text-slate-600">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {backups?.map((b) => (
                <tr key={b.filename}>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{b.filename}</td>
                  <td className="px-4 py-2 text-slate-600">{formatBytes(b.sizeBytes)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(b.createdAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-4">
                      <a
                        href={apiFileUrl(`/backups/${b.filename}/download`)}
                        className="text-xs font-medium text-amber-700 hover:underline"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => handleDelete(b.filename)}
                        disabled={deletingFilename === b.filename}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {backups?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                    No backups yet. Create one to get started.
                  </td>
                </tr>
              )}
              {backups === null && !error && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                    Loading…
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
