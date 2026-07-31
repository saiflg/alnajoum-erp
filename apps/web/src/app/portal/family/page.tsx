'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CountrySelect } from '@/components/CountrySelect';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { apiFileUrl, apiRequest, apiUpload, ApiError } from '@/lib/api';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/lib/document-types';
import { PORTAL_NAV } from '@/lib/portal-nav';
import { DocumentType, FamilyMember, FamilyMemberDocument, FamilyRelationship } from '@/lib/types';

const RELATIONSHIPS: FamilyRelationship[] = [
  'SPOUSE',
  'CHILD',
  'PARENT',
  'SIBLING',
  'GUARDIAN',
  'OTHER',
];

interface FormState {
  relationship: FamilyRelationship;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  passportNumber: string;
}

const EMPTY_FORM: FormState = {
  relationship: 'CHILD',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  nationality: '',
  passportNumber: '',
};

export default function FamilyMembersPage() {
  const [members, setMembers] = useState<FamilyMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newMember, setNewMember] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [documentsByMember, setDocumentsByMember] = useState<
    Record<string, FamilyMemberDocument[]>
  >({});
  const [docType, setDocType] = useState<DocumentType>('PASSPORT');
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    apiRequest<FamilyMember[]>('/customers/me/family-members')
      .then(setMembers)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiRequest('/customers/me/family-members', { method: 'POST', body: newMember });
      setNewMember(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add family member');
    } finally {
      setCreating(false);
    }
  }

  function startEdit(member: FamilyMember) {
    setEditingId(member.id);
    setEditForm({
      relationship: member.relationship,
      firstName: member.firstName,
      lastName: member.lastName,
      dateOfBirth: member.dateOfBirth?.slice(0, 10) ?? '',
      nationality: member.nationality ?? '',
      passportNumber: member.passportNumber ?? '',
    });
  }

  async function handleSaveEdit(memberId: string) {
    setError(null);
    try {
      await apiRequest(`/customers/me/family-members/${memberId}`, {
        method: 'PATCH',
        body: editForm,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save changes');
    }
  }

  async function handleDelete(memberId: string) {
    if (!confirm('Remove this family member?')) return;
    try {
      await apiRequest(`/customers/me/family-members/${memberId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove family member');
    }
  }

  async function toggleDocuments(memberId: string) {
    if (expandedId === memberId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(memberId);
    if (!documentsByMember[memberId]) {
      try {
        const docs = await apiRequest<FamilyMemberDocument[]>(
          `/customers/me/family-members/${memberId}/documents`,
        );
        setDocumentsByMember((prev) => ({ ...prev, [memberId]: docs }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to load documents');
      }
    }
  }

  async function handleUpload(e: FormEvent, memberId: string) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setError(null);
    setUploadingFor(memberId);
    try {
      await apiUpload(
        `/customers/me/family-members/${memberId}/documents?type=${docType}`,
        file,
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      const docs = await apiRequest<FamilyMemberDocument[]>(
        `/customers/me/family-members/${memberId}/documents`,
      );
      setDocumentsByMember((prev) => ({ ...prev, [memberId]: docs }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload document');
    } finally {
      setUploadingFor(null);
    }
  }

  async function handleDeleteDocument(memberId: string, documentId: string) {
    if (!confirm('Delete this document?')) return;
    try {
      await apiRequest(`/customers/me/family-members/${memberId}/documents/${documentId}`, {
        method: 'DELETE',
      });
      const docs = await apiRequest<FamilyMemberDocument[]>(
        `/customers/me/family-members/${memberId}/documents`,
      );
      setDocumentsByMember((prev) => ({ ...prev, [memberId]: docs }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete document');
    }
  }

  return (
    <ProtectedRoute allowedRoles={['CUSTOMER']}>
      <AppShell title="Family Members" navLinks={PORTAL_NAV}>
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <h2 className="text-lg font-semibold text-slate-900">Family Members</h2>
        <p className="mt-1 text-sm text-slate-500">
          Add spouses, children, or other dependents to include them on
          bookings and applications later.
        </p>

        <form
          onSubmit={handleCreate}
          className="mt-4 grid max-w-2xl grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3"
        >
          <select
            value={newMember.relationship}
            onChange={(e) =>
              setNewMember({ ...newMember, relationship: e.target.value as FamilyRelationship })
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
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
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <input
            required
            placeholder="Last name"
            value={newMember.lastName}
            onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <input
            type="date"
            placeholder="Date of birth"
            value={newMember.dateOfBirth}
            onChange={(e) => setNewMember({ ...newMember, dateOfBirth: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <CountrySelect
            placeholder="Nationality"
            value={newMember.nationality}
            onChange={(value) => setNewMember({ ...newMember, nationality: value })}
          />
          <input
            placeholder="Passport #"
            value={newMember.passportNumber}
            onChange={(e) => setNewMember({ ...newMember, passportNumber: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={creating}
            className="col-span-2 w-fit rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 sm:col-span-3"
          >
            {creating ? 'Adding…' : 'Add family member'}
          </button>
        </form>

        <div className="mt-6 space-y-3">
          {members?.map((member) => (
            <div key={member.id} className="rounded-lg border border-slate-200 bg-white p-4">
              {editingId === member.id ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <select
                    value={editForm.relationship}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
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
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <CountrySelect
                    value={editForm.nationality}
                    onChange={(value) => setEditForm({ ...editForm, nationality: value })}
                    placeholder="Nationality"
                  />
                  <input
                    value={editForm.passportNumber}
                    onChange={(e) =>
                      setEditForm({ ...editForm, passportNumber: e.target.value })
                    }
                    placeholder="Passport #"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveEdit(member.id)}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">
                      {member.firstName} {member.lastName}{' '}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {member.relationship}
                      </span>
                    </p>
                    <p className="text-sm text-slate-500">
                      {member.nationality ?? 'Nationality unknown'}
                      {member.passportNumber ? ` · Passport ${member.passportNumber}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-3 text-sm font-medium">
                    <button onClick={() => toggleDocuments(member.id)} className="text-slate-700 hover:underline">
                      Documents
                    </button>
                    <button onClick={() => startEdit(member)} className="text-slate-700 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(member.id)} className="text-red-600 hover:underline">
                      Remove
                    </button>
                  </div>
                </div>
              )}

              {expandedId === member.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <form
                    onSubmit={(e) => handleUpload(e, member.id)}
                    className="flex items-end gap-3"
                  >
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value as DocumentType)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      {DOCUMENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {DOCUMENT_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="flex-1 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={uploadingFor === member.id}
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {uploadingFor === member.id ? 'Uploading…' : 'Upload'}
                    </button>
                  </form>

                  <ul className="mt-3 divide-y divide-slate-100 text-sm">
                    {documentsByMember[member.id]?.map((doc) => (
                      <li key={doc.id} className="flex items-center justify-between py-2">
                        <span className="text-slate-700">
                          {DOCUMENT_TYPE_LABELS[doc.type]} — {doc.originalFileName}
                        </span>
                        <span className="space-x-3">
                          <a
                            href={apiFileUrl(
                              `/customers/me/family-members/${member.id}/documents/${doc.id}/file`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-slate-700 hover:underline"
                          >
                            View
                          </a>
                          <button
                            onClick={() => handleDeleteDocument(member.id, doc.id)}
                            className="font-medium text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </span>
                      </li>
                    ))}
                    {documentsByMember[member.id]?.length === 0 && (
                      <li className="py-2 text-slate-500">No documents uploaded yet.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          ))}
          {members?.length === 0 && (
            <p className="text-sm text-slate-500">No family members added yet.</p>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
