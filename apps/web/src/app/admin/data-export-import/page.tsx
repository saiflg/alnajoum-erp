'use client';

import { FormEvent, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiFileUrl, apiUpload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface ImportIssue {
  row: number;
  email?: string;
  reason: string;
}

interface CustomerImportResult {
  totalRows: number;
  created: number;
  skipped: number;
  issues: ImportIssue[];
}

const EXPORTS: Array<{ key: string; label: string; description: string }> = [
  {
    key: 'customers',
    label: 'Customers',
    description: 'Every customer in your company — name, contact details, assigned staff and branch.',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    description: 'Every invoice — customer, status, total amount, and amount paid.',
  },
  {
    key: 'flight-bookings',
    label: 'Flight Bookings',
    description: 'Every flight booking — route, status, and amount.',
  },
];

/**
 * Phase 11's "data export/import" — a real gap, not just an unwired
 * backend, so this is a small, self-contained admin tool rather than a
 * page bolted onto an existing list view. Exports are plain downloads
 * (apiFileUrl relies on the shared auth cookie, same pattern as the
 * customer document download links); import is a single upload with
 * the resulting per-row summary shown inline, since a 50-row CSV
 * failing on row 37 is useless without knowing which row and why.
 */
export default function DataExportImportPage() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CustomerImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const canExport = user?.permissions.includes('data:export') ?? false;
  const canImport = user?.permissions.includes('data:import') ?? false;
  const isSuperAdmin = user?.roles.includes('SUPER_ADMIN') ?? false;

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setResult(null);
    setUploading(true);
    try {
      const res = await apiUpload<CustomerImportResult>('/data-import/customers', file);
      setResult(res);
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN']}>
      <AppShell title="Data Export &amp; Import" navLinks={ADMIN_NAV}>
        <h2 className="text-lg font-semibold text-slate-900">Data Export &amp; Import</h2>
        <p className="mt-1 text-sm text-slate-500">
          {isSuperAdmin
            ? 'As Super Admin, an export includes every tenant. Import is unavailable — there is no single tenant to attribute new customers to.'
            : 'Exports and imports are scoped to your own company only.'}
        </p>

        {canExport && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900">Export</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {EXPORTS.map((exp) => (
                <a
                  key={exp.key}
                  href={apiFileUrl(`/data-export/${exp.key}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50"
                >
                  <h4 className="font-medium text-slate-900">{exp.label}</h4>
                  <p className="mt-1 flex-1 text-xs text-slate-500">{exp.description}</p>
                  <span className="mt-3 text-xs font-medium text-amber-700">Download CSV →</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {canImport && !isSuperAdmin && (
          <div className="mt-8 max-w-lg">
            <h3 className="text-sm font-semibold text-slate-900">Import Customers</h3>
            <p className="mt-1 text-xs text-slate-500">
              CSV columns: Email, First Name, Last Name, Phone (optional). A new
              account is created for each row with a temporary password emailed
              to them; a row whose email already has an account is skipped, not
              overwritten.
            </p>

            <form onSubmit={handleImport} className="mt-4 flex items-center gap-3">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="flex-1 text-sm text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
              />
              <button
                type="submit"
                disabled={!file || uploading}
                className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Upload CSV'}
              </button>
            </form>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            {result && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-700">
                  {result.totalRows} row{result.totalRows === 1 ? '' : 's'} processed —{' '}
                  <span className="font-medium text-green-700">{result.created} created</span>,{' '}
                  <span className="font-medium text-slate-500">{result.skipped} skipped</span>,{' '}
                  <span className="font-medium text-amber-700">{result.issues.length} issue{result.issues.length === 1 ? '' : 's'}</span>
                </p>
                {result.issues.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    {result.issues.map((issue, i) => (
                      <li key={i}>
                        Row {issue.row}
                        {issue.email ? ` (${issue.email})` : ''}: {issue.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
