'use client';

/* eslint-disable @next/next/no-img-element -- the photograph comes from the API origin, not from an optimisable asset */
import { fmtDate } from '@/components/comm/ui';

export interface Verification {
  result: 'VALID' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED' | 'REPLACED' | 'INVALID';
  label: string;
  message: string;
  checkedAt: string;
  company: { name: string } | null;
  card: { number: string; validUntil: string | null } | null;
  staff: { fullName: string; staffId: string; department: string | null; jobTitle: string | null; branch: string | null; hasPhoto: boolean } | null;
  photoPath?: string;
  /** Phase 26B: how the card was checked and how much that proves. */
  method?: string;
  assurance?: string;
  simulated?: boolean;
  warnings?: string[];
}

const METHOD_TEXT: Record<string, string> = {
  QR: 'QR code scanned',
  PUBLIC_LINK: 'QR link opened',
  MANUAL_STAFF_ID: 'Staff ID typed in',
  MANUAL_REFERENCE: 'Card number typed in',
  NFC: 'NFC card tapped',
  NFC_UID: 'NFC card tapped (serial number only)',
  PUBLIC_NFC_LINK: 'NFC card tapped (opened on a phone)',
  QR_AND_NFC: 'QR code and NFC chip checked together',
};
const ASSURANCE_TEXT: Record<string, string> = {
  OPAQUE_REFERENCE: 'Checked against the reference on the chip. A copied chip would carry a copied reference.',
  UID_ONLY: 'Weak check: only the chip serial number was read, and serial numbers can be copied.',
  QR_AND_NFC: 'QR code and NFC chip both lead to the same card.',
};

const TONE: Record<Verification['result'], { box: string; head: string; icon: string }> = {
  VALID: { box: 'border-emerald-300 bg-emerald-50', head: 'bg-emerald-600 text-white', icon: '✔' },
  EXPIRED: { box: 'border-orange-300 bg-orange-50', head: 'bg-orange-600 text-white', icon: '⏱' },
  SUSPENDED: { box: 'border-yellow-300 bg-yellow-50', head: 'bg-yellow-600 text-white', icon: '⏸' },
  REVOKED: { box: 'border-red-300 bg-red-50', head: 'bg-red-700 text-white', icon: '✖' },
  REPLACED: { box: 'border-slate-300 bg-slate-50', head: 'bg-slate-600 text-white', icon: '↻' },
  INVALID: { box: 'border-red-300 bg-red-50', head: 'bg-red-700 text-white', icon: '?' },
};

/**
 * What a scan shows. The colour, icon AND text all carry the result, so it is clear to someone who cannot tell
 * colours apart and is announced by a screen reader.
 */
export function VerificationPanel({ v, photoUrl }: { v: Verification; photoUrl?: string | null }) {
  const tone = TONE[v.result];
  return (
    <div className={`overflow-hidden rounded-xl border-2 ${tone.box}`} role="status" aria-live="polite">
      <div className={`flex items-center gap-3 px-4 py-3 ${tone.head}`}>
        <span className="text-2xl" aria-hidden>{tone.icon}</span>
        <p className="text-lg font-bold tracking-wide">{v.label}</p>
      </div>
      <div className="p-4">
        {v.staff ? (
          <div className="flex gap-4">
            {photoUrl && v.staff.hasPhoto ? (
              <img src={photoUrl} alt={`Photograph of ${v.staff.fullName}`} className="h-36 w-28 rounded-md border border-slate-300 object-cover" />
            ) : (
              <div className="flex h-36 w-28 items-center justify-center rounded-md border border-slate-300 bg-slate-100 text-3xl font-bold text-slate-400" aria-label="No photograph on file">
                {v.staff.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join('')}
              </div>
            )}
            <dl className="space-y-1.5 text-sm">
              <div><dt className="text-[11px] uppercase text-slate-500">Name</dt><dd className="text-lg font-semibold text-slate-900">{v.staff.fullName}</dd></div>
              <div><dt className="text-[11px] uppercase text-slate-500">Staff ID</dt><dd className="font-mono font-semibold">{v.staff.staffId}</dd></div>
              {v.staff.department && <div><dt className="text-[11px] uppercase text-slate-500">Department</dt><dd>{v.staff.department}</dd></div>}
              {v.staff.jobTitle && <div><dt className="text-[11px] uppercase text-slate-500">Job title</dt><dd>{v.staff.jobTitle}</dd></div>}
              {v.staff.branch && <div><dt className="text-[11px] uppercase text-slate-500">Branch</dt><dd>{v.staff.branch}</dd></div>}
            </dl>
          </div>
        ) : null}
        <p className={`${v.staff ? 'mt-4' : ''} text-sm text-slate-700`}>{v.message}</p>
        {v.simulated && <p className="mt-3 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">SIMULATED — this came from the test reader, not from a real card.</p>}
        {v.method && (
          <p className="mt-3 text-xs text-slate-600">
            <b>Checked by:</b> {METHOD_TEXT[v.method] ?? v.method}
            {v.assurance && ASSURANCE_TEXT[v.assurance] ? <> — {ASSURANCE_TEXT[v.assurance]}</> : null}
          </p>
        )}
        {v.warnings && v.warnings.length > 0 && v.result === 'VALID' && (
          <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {v.company ? `${v.company.name} · ` : ''}
          {v.card ? `Card ${v.card.number} · valid until ${fmtDate(v.card.validUntil)} · ` : ''}
          checked {new Date(v.checkedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
