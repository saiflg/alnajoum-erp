'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CardBack, CardFront, CardPreviewData } from '@/components/staff-cards/CardFace';
import { FilePickButton } from '@/components/staff-cards/FilePickButton';
import { Field, Msg, PageTitle, Row, btn, btnGhost, card, input, useAction } from '@/components/comm/ui';
import { apiRequest, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';
import { useApi } from '@/lib/use-api';

type Form = Record<string, string>;
const TEXT_FIELDS: [string, string, string?][] = [
  ['displayName', 'Name printed on the card'],
  ['tagline', 'Tagline (optional)'],
  ['contactPhone', 'Contact phone'],
  ['contactEmail', 'Contact email'],
  ['website', 'Website'],
  ['contactAddress', 'Address'],
  ['emergencyContact', 'Emergency contact (optional)', 'Shown on the back of the card.'],
  ['officialRegistrationLine', 'Registration / accreditation line (optional)', 'Printed only if you type it. The system never invents one.'],
  ['signatoryName', 'Authorised signatory'],
  ['signatoryTitle', 'Signatory title'],
];

function Settings() {
  const { user } = useAuth();
  const can = (p: string) => !!user?.permissions.includes(p);
  const editable = can('staff_card:settings');
  const [refresh, setRefresh] = useState(0);
  const { data: s, error: loadError } = useApi<Row>('/staff-cards/settings', refresh);
  const { act, error, notice, busy } = useAction(() => setRefresh((n) => n + 1));
  const [edits, setEdits] = useState<Form>({});

  if (loadError) return <Msg error={loadError} />;
  if (!s) return <p className="text-sm text-slate-500">Loading…</p>;

  const val = (k: string) => (k in edits ? edits[k] : (s[k] ?? '')) as string;
  const set = (k: string, v: string) => setEdits((e) => ({ ...e, [k]: v }));

  const sample: CardPreviewData = {
    cardNumber: 'ALN-C-SAMP-LE00', status: 'ACTIVE', effectiveStatus: 'ACTIVE', fullName: 'Amina Yusuf', employeeCode: 'EMP-0042',
    jobTitle: 'Senior Travel Consultant', department: 'Sales', branchName: 'Head Office', issuedAt: '2026-01-15T00:00:00.000Z',
    expiresAt: '2028-01-15T00:00:00.000Z', verifyUrl: '', qrDataUrl: null, photoDataUrl: null,
    logoDataUrl: s.logoDataUrl, signatureDataUrl: s.signatureDataUrl,
    design: {
      displayName: val('displayName') || 'Your company', tagline: val('tagline') || null, primaryColor: val('primaryColor') || '#0f172a', accentColor: val('accentColor') || '#f59e0b',
      contactPhone: val('contactPhone') || null, contactEmail: val('contactEmail') || null, contactAddress: val('contactAddress') || null, website: val('website') || null,
      officialRegistrationLine: val('officialRegistrationLine') || null, emergencyContact: val('emergencyContact') || null, lostCardNotice: val('lostCardNotice'),
      signatoryName: val('signatoryName') || null, signatoryTitle: val('signatoryTitle') || null,
    },
  };

  async function save() {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(edits)) {
      if (k === 'validityMonths' || k === 'expiryWarningDays') body[k] = Number(v);
      else body[k] = v;
    }
    await apiRequest('/staff-cards/settings', { method: 'PUT', body });
    setEdits({});
  }

  return (
    <>
      <PageTitle title="Card design" subtitle="How the company's identification cards look and what they say. Changes apply to cards printed from now on; nothing on a card is made up — every line below is typed in by you." actions={<Link className={btnGhost} href="/admin/staff-cards">← Cards</Link>} />
      <Msg error={error} notice={notice} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className={`${card} space-y-4`}>
          <div className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map(([k, label, hint]) => (
              <Field key={k} label={label} hint={hint}>
                <input className={input} value={val(k)} disabled={!editable} onChange={(e) => set(k, e.target.value)} />
              </Field>
            ))}
            <Field label="Main colour"><div className="flex gap-2"><input type="color" aria-label="Main colour" value={val('primaryColor')} disabled={!editable} onChange={(e) => set('primaryColor', e.target.value)} /><input className={input} value={val('primaryColor')} disabled={!editable} onChange={(e) => set('primaryColor', e.target.value)} /></div></Field>
            <Field label="Accent colour"><div className="flex gap-2"><input type="color" aria-label="Accent colour" value={val('accentColor')} disabled={!editable} onChange={(e) => set('accentColor', e.target.value)} /><input className={input} value={val('accentColor')} disabled={!editable} onChange={(e) => set('accentColor', e.target.value)} /></div></Field>
            <Field label="Card validity (months)"><input className={input} type="number" min={1} max={120} value={val('validityMonths')} disabled={!editable} onChange={(e) => set('validityMonths', e.target.value)} /></Field>
            <Field label="Warn administrators before expiry (days)"><input className={input} type="number" min={1} max={180} value={val('expiryWarningDays')} disabled={!editable} onChange={(e) => set('expiryWarningDays', e.target.value)} /></Field>
          </div>
          <Field label="Lost-card notice (back of the card)"><textarea className={input} rows={2} value={val('lostCardNotice')} disabled={!editable} onChange={(e) => set('lostCardNotice', e.target.value)} /></Field>
          {editable ? (
            <button className={btn} disabled={busy || Object.keys(edits).length === 0} onClick={() => act(save, 'Design saved.')}>Save design</button>
          ) : <p className="text-xs text-slate-500">You can view the design; changing it needs the card-design permission.</p>}
        </div>

        <div className="space-y-4">
          <div className={card}>
            <h2 className="mb-2 text-sm font-semibold">Preview</h2>
            <div className="space-y-3 overflow-x-auto"><CardFront c={sample} /><CardBack c={sample} /></div>
            <p className="mt-2 text-[11px] text-slate-400">Sample data. The QR code appears on real cards.</p>
          </div>
          {editable && (
            <div className={card}>
              <h2 className="text-sm font-semibold">Logo and signature</h2>
              {(['logo', 'signature'] as const).map((kind) => (
                <div key={kind} className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600">{kind === 'logo' ? 'Company logo' : 'Authorised signature (optional)'} — {s[kind === 'logo' ? 'logoDataUrl' : 'signatureDataUrl'] ? 'uploaded' : 'none'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <FilePickButton
                      className={btnGhost}
                      accept="image/png,image/jpeg"
                      disabled={busy}
                      label={s[kind === 'logo' ? 'logoDataUrl' : 'signatureDataUrl'] ? 'Choose a new image…' : 'Choose image and upload…'}
                      onFile={(f) => act(async () => { await apiUpload(`/staff-cards/settings/${kind}`, f); }, `${kind === 'logo' ? 'Logo' : 'Signature'} saved.`)}
                    />
                    {s[kind === 'logo' ? 'logoDataUrl' : 'signatureDataUrl'] && <button className={btnGhost} disabled={busy} onClick={() => act(() => apiRequest(`/staff-cards/settings/${kind}`, { method: 'DELETE' }), `${kind === 'logo' ? 'Logo' : 'Signature'} removed.`)}>Remove</button>}
                  </div>
                </div>
              ))}
              <p className="mt-3 text-[11px] text-slate-400">PNG or JPEG. Images are resized and re-encoded; a transparent PNG keeps its transparency.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function CardSettingsPage() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'AUDITOR']}>
      <AppShell title="Card design" navLinks={navForRoles(user?.roles ?? [])}>
        <Settings />
      </AppShell>
    </ProtectedRoute>
  );
}
