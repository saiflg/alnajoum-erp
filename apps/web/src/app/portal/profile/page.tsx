'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CountrySelect } from '@/components/CountrySelect';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiFileUrl, apiRequest, apiUpload, ApiError } from '@/lib/api';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/lib/document-types';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { CustomerProfile, DocumentType } from '@/lib/types';

export default function CustomerProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nationality, setNationality] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [passportNumber, setPassportNumber] = useState('');

  const [docType, setDocType] = useState<DocumentType>('PASSPORT');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    apiRequest<CustomerProfile>('/customers/me')
      .then((data) => {
        setProfile(data);
        setFirstName(data.firstName);
        setLastName(data.lastName);
        setNationality(data.nationality ?? '');
        setCity(data.city ?? '');
        setCountry(data.country ?? '');
        setPassportNumber(data.passportNumber ?? '');
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiRequest('/customers/me', {
        method: 'PATCH',
        body: { firstName, lastName, nationality, city, country, passportNumber },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      await apiUpload(`/customers/me/documents?type=${docType}`, file);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDocument(documentId: string) {
    if (!confirm('Delete this document?')) return;
    try {
      await apiRequest(`/customers/me/documents/${documentId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete document');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="My Profile" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {profile && (
          <>
            <h2 className="text-lg font-semibold text-slate-900">My Profile</h2>
            <p className="text-sm text-slate-500">{profile.identity?.email}</p>

            <form onSubmit={handleSave} className="mt-6 grid max-w-lg grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">First name</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Last name</label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Nationality</label>
                <CountrySelect value={nationality} onChange={setNationality} className="mt-1 w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Passport #</label>
                <input
                  value={passportNumber}
                  onChange={(e) => setPassportNumber(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">City</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Country</label>
                <CountrySelect value={country} onChange={setCountry} className="mt-1 w-full" />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>

            <h3 className="mt-10 text-sm font-semibold text-slate-900">My Documents</h3>

            <form onSubmit={handleUpload} className="mt-2 flex max-w-lg items-end gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700">Document type</label>
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                >
                  {DOCUMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DOCUMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700">File</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  className="mt-1 w-full text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={uploading}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </form>

            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">File</th>
                    <th className="px-4 py-2 text-left font-medium text-slate-600">Uploaded</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {profile.documents?.map((doc) => (
                    <tr key={doc.id}>
                      <td className="px-4 py-2 text-slate-700">{DOCUMENT_TYPE_LABELS[doc.type]}</td>
                      <td className="px-4 py-2 text-slate-600">{doc.originalFileName}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-right space-x-3">
                        <a
                          href={apiFileUrl(`/customers/me/documents/${doc.id}/file`)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-slate-700 hover:underline"
                        >
                          View
                        </a>
                        <button
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!profile.documents || profile.documents.length === 0) && (
                    <tr>
                      <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                        No documents uploaded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
