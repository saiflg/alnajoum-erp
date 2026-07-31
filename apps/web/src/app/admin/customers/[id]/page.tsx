'use client';

import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CountrySelect } from '@/components/CountrySelect';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ADMIN_NAV } from '@/lib/admin-nav';
import { apiFileUrl, apiRequest, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { DOCUMENT_TYPE_LABELS } from '@/lib/document-types';
import {
  CustomerProfile,
  FamilyMember,
  FamilyMemberDocument,
  FamilyRelationship,
} from '@/lib/types';

const RELATIONSHIPS: FamilyRelationship[] = [
  'SPOUSE',
  'CHILD',
  'PARENT',
  'SIBLING',
  'GUARDIAN',
  'OTHER',
];

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canUpdate = !!user?.permissions.includes('customer:update');
  const canDelete = !!user?.permissions.includes('customer:delete');

  const [nationality, setNationality] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [passportNumber, setPassportNumber] = useState('');

  const [showAddMember, setShowAddMember] = useState(false);
  const [newMember, setNewMember] = useState({
    relationship: 'CHILD' as FamilyRelationship,
    firstName: '',
    lastName: '',
    nationality: '',
    passportNumber: '',
  });
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberDocuments, setMemberDocuments] = useState<
    Record<string, FamilyMemberDocument[]>
  >({});

  function load() {
    apiRequest<CustomerProfile>(`/customers/${params.id}`)
      .then((data) => {
        setCustomer(data);
        setNationality(data.nationality ?? '');
        setCity(data.city ?? '');
        setCountry(data.country ?? '');
        setPassportNumber(data.passportNumber ?? '');
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [params.id]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/customers/${params.id}`, {
        method: 'PATCH',
        body: { nationality, city, country, passportNumber },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm('Deactivate this customer account? They will no longer be able to log in.')) {
      return;
    }
    try {
      await apiRequest(`/customers/${params.id}`, { method: 'DELETE' });
      router.push('/admin/customers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to deactivate customer');
    }
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest(`/customers/${params.id}/family-members`, {
        method: 'POST',
        body: newMember,
      });
      setNewMember({
        relationship: 'CHILD',
        firstName: '',
        lastName: '',
        nationality: '',
        passportNumber: '',
      });
      setShowAddMember(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add family member');
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Remove this family member?')) return;
    try {
      await apiRequest(`/customers/${params.id}/family-members/${memberId}`, {
        method: 'DELETE',
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove family member');
    }
  }

  async function toggleMemberDocuments(memberId: string) {
    if (expandedMemberId === memberId) {
      setExpandedMemberId(null);
      return;
    }
    setExpandedMemberId(memberId);
    if (!memberDocuments[memberId]) {
      try {
        const docs = await apiRequest<FamilyMemberDocument[]>(
          `/customers/${params.id}/family-members/${memberId}/documents`,
        );
        setMemberDocuments((prev) => ({ ...prev, [memberId]: docs }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load documents');
      }
    }
  }

  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'STAFF']}>
      <AppShell title="Customer Detail" navLinks={ADMIN_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {customer && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {customer.firstName} {customer.lastName}
              </h2>
              {canDelete && (
                <button
                  onClick={handleDeactivate}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Deactivate
                </button>
              )}
            </div>
            <p className="text-sm text-slate-500">{customer.identity?.email}</p>

            <form onSubmit={handleSave} className="mt-6 grid max-w-lg grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Nationality</label>
                <CountrySelect
                  disabled={!canUpdate}
                  value={nationality}
                  onChange={setNationality}
                  className="mt-1 w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Passport #</label>
                <input
                  disabled={!canUpdate}
                  value={passportNumber}
                  onChange={(e) => setPassportNumber(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">City</label>
                <input
                  disabled={!canUpdate}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 focus:border-slate-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Country</label>
                <CountrySelect
                  disabled={!canUpdate}
                  value={country}
                  onChange={setCountry}
                  className="mt-1 w-full"
                />
              </div>

              {canUpdate && (
                <button
                  type="submit"
                  disabled={saving}
                  className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              )}
            </form>

            <h3 className="mt-8 text-sm font-semibold text-slate-900">Documents</h3>
            <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
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
                  {customer.documents?.map((doc) => (
                    <tr key={doc.id}>
                      <td className="px-4 py-2 text-slate-700">{DOCUMENT_TYPE_LABELS[doc.type]}</td>
                      <td className="px-4 py-2 text-slate-600">{doc.originalFileName}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {new Date(doc.uploadedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <a
                          href={apiFileUrl(`/customers/${customer.id}/documents/${doc.id}/file`)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-slate-700 hover:underline"
                        >
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                  {(!customer.documents || customer.documents.length === 0) && (
                    <tr>
                      <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                        No documents uploaded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Family Members</h3>
              {canUpdate && (
                <button
                  onClick={() => setShowAddMember((v) => !v)}
                  className="text-sm font-medium text-slate-700 hover:underline"
                >
                  {showAddMember ? 'Cancel' : '+ Add family member'}
                </button>
              )}
            </div>

            {showAddMember && (
              <form
                onSubmit={handleAddMember}
                className="mt-2 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
              >
                <select
                  value={newMember.relationship}
                  onChange={(e) =>
                    setNewMember({
                      ...newMember,
                      relationship: e.target.value as FamilyRelationship,
                    })
                  }
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {RELATIONSHIPS.map((rel) => (
                    <option key={rel} value={rel}>
                      {rel}
                    </option>
                  ))}
                </select>
                <input
                  required
                  placeholder="First name"
                  value={newMember.firstName}
                  onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  placeholder="Last name"
                  value={newMember.lastName}
                  onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <CountrySelect
                  placeholder="Nationality"
                  value={newMember.nationality}
                  onChange={(value) => setNewMember({ ...newMember, nationality: value })}
                />
                <input
                  placeholder="Passport #"
                  value={newMember.passportNumber}
                  onChange={(e) =>
                    setNewMember({ ...newMember, passportNumber: e.target.value })
                  }
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Add
                </button>
              </form>
            )}

            <div className="mt-2 space-y-2">
              {customer.familyMembers?.map((member: FamilyMember) => (
                <div key={member.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-800">
                        {member.firstName} {member.lastName}{' '}
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {member.relationship}
                        </span>
                      </p>
                      <p className="text-sm text-slate-500">
                        {member.nationality ?? '—'}
                        {member.passportNumber ? ` · Passport ${member.passportNumber}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-3 text-sm font-medium">
                      <button
                        onClick={() => toggleMemberDocuments(member.id)}
                        className="text-slate-700 hover:underline"
                      >
                        Documents
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedMemberId === member.id && (
                    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 pt-3 text-sm">
                      {memberDocuments[member.id]?.map((doc) => (
                        <li key={doc.id} className="flex items-center justify-between py-1.5">
                          <span className="text-slate-700">
                            {DOCUMENT_TYPE_LABELS[doc.type]} — {doc.originalFileName}
                          </span>
                          <a
                            href={apiFileUrl(
                              `/customers/${customer.id}/family-members/${member.id}/documents/${doc.id}/file`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-slate-700 hover:underline"
                          >
                            View
                          </a>
                        </li>
                      ))}
                      {memberDocuments[member.id]?.length === 0 && (
                        <li className="py-1.5 text-slate-500">No documents uploaded.</li>
                      )}
                    </ul>
                  )}
                </div>
              ))}
              {(!customer.familyMembers || customer.familyMembers.length === 0) && (
                <p className="text-sm text-slate-500">No family members recorded.</p>
              )}
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
