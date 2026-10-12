'use client';

/* eslint-disable @next/next/no-img-element -- the card images are data URLs produced by the API, not optimisable assets */
import { fmtDate } from '@/components/comm/ui';

export interface CardPreviewData {
  cardNumber: string;
  status: string;
  effectiveStatus: string;
  fullName: string;
  employeeCode: string;
  jobTitle: string | null;
  department: string | null;
  branchName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  verifyUrl: string;
  qrDataUrl: string | null;
  photoDataUrl: string | null;
  logoDataUrl: string | null;
  signatureDataUrl: string | null;
  design: {
    displayName: string;
    tagline: string | null;
    primaryColor: string;
    accentColor: string;
    contactPhone: string | null;
    contactEmail: string | null;
    contactAddress: string | null;
    website: string | null;
    officialRegistrationLine: string | null;
    emergencyContact: string | null;
    lostCardNotice: string;
    signatoryName: string | null;
    signatoryTitle: string | null;
  };
}

// CR80 proportions (85.6 x 54 mm).
const W = 342;
const H = 216;

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      aria-label={label}
      className="relative overflow-hidden rounded-xl bg-white text-slate-900 shadow-md ring-1 ring-slate-300 print:shadow-none"
      style={{ width: W, height: H }}
    >
      {children}
    </div>
  );
}

export function CardFront({ c }: { c: CardPreviewData }) {
  const d = c.design;
  return (
    <Frame label={`Front of the identification card of ${c.fullName}`}>
      <div className="flex items-center gap-2 px-3" style={{ height: 50, background: d.primaryColor }}>
        {c.logoDataUrl && <img src={c.logoDataUrl} alt="" className="h-8 w-8 object-contain" />}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold uppercase tracking-wide text-white">{d.displayName}</p>
          {d.tagline && <p className="truncate text-[8px]" style={{ color: d.accentColor }}>{d.tagline}</p>}
        </div>
      </div>
      <div style={{ height: 3.5, background: d.accentColor }} />
      <div className="flex gap-3 px-4 pt-3">
        <div className="shrink-0 overflow-hidden rounded-sm bg-slate-200" style={{ width: 82, height: 102, border: `1.5px solid ${d.accentColor}` }}>
          {c.photoDataUrl ? (
            <img src={c.photoDataUrl} alt={`Photograph of ${c.fullName}`} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-2xl font-bold text-slate-500">{initials(c.fullName)}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight">{c.fullName}</p>
          <div className="mt-1 space-y-0.5 text-[10px] text-slate-600">
            {c.jobTitle && <p className="truncate">{c.jobTitle}</p>}
            {c.department && <p className="truncate">{c.department}</p>}
            {c.branchName && <p className="truncate">{c.branchName}</p>}
          </div>
          <p className="mt-2 text-[7px] uppercase tracking-wide text-slate-500">Staff ID</p>
          <p className="truncate text-sm font-bold" style={{ color: d.primaryColor }}>{c.employeeCode}</p>
        </div>
        <div className="shrink-0 text-center">
          {c.qrDataUrl && <img src={c.qrDataUrl} alt="QR code that verifies this card" className="h-[82px] w-[82px]" />}
          <p className="text-[7px] text-slate-500">Scan to verify</p>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-1.5 pt-1.5 text-white" style={{ background: d.primaryColor, height: 31 }}>
        <div><p className="text-[7px] text-slate-300">CARD NO.</p><p className="text-[10px] font-bold">{c.cardNumber}</p></div>
        <div><p className="text-[7px] text-slate-300">ISSUED</p><p className="text-[10px] font-bold">{fmtDate(c.issuedAt)}</p></div>
        <div><p className="text-[7px] text-slate-300">EXPIRES</p><p className="text-[10px] font-bold">{fmtDate(c.expiresAt)}</p></div>
      </div>
      {c.status === 'PENDING' && (
        <div className="absolute right-2 top-14 rotate-6 rounded border-2 border-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700 print:hidden">Not yet activated</div>
      )}
    </Frame>
  );
}

export function CardBack({ c }: { c: CardPreviewData }) {
  const d = c.design;
  const contact = [d.contactPhone, d.contactEmail, d.website, d.contactAddress].filter(Boolean).join('  ·  ');
  return (
    <Frame label={`Back of the identification card of ${c.fullName}`}>
      <div className="px-3 py-1.5" style={{ background: d.primaryColor }}>
        <p className="truncate text-[10px] font-bold uppercase tracking-wide text-white">{d.displayName}</p>
      </div>
      <div style={{ height: 2.5, background: d.accentColor }} />
      <div className="flex gap-3 px-4 pt-3">
        <div className="min-w-0 flex-1 space-y-1.5 text-[8.5px] leading-snug text-slate-700">
          <p>This card is the property of {d.displayName}. It identifies the holder as a member of staff, must be shown on request and may not be lent to anyone else.</p>
          <p className="font-bold text-slate-900">{d.lostCardNotice}</p>
          {contact && <p>{contact}</p>}
          {d.emergencyContact && <p className="font-bold">Emergency: {d.emergencyContact}</p>}
          {d.officialRegistrationLine && <p className="text-slate-500">{d.officialRegistrationLine}</p>}
        </div>
        <div className="w-[88px] shrink-0 text-center">
          {c.qrDataUrl && <img src={c.qrDataUrl} alt="QR code that verifies this card" className="mx-auto h-[78px] w-[78px]" />}
          <p className="mt-1 text-[7px] leading-tight text-slate-500">Scan to confirm this card is genuine and still valid.</p>
          <p className="mt-1.5 text-[9px] font-bold" style={{ color: d.primaryColor }}>{c.cardNumber}</p>
        </div>
      </div>
      {(d.signatoryName || c.signatureDataUrl) && (
        <div className="absolute bottom-3 left-4 w-36">
          {c.signatureDataUrl && <img src={c.signatureDataUrl} alt="Authorised signature" className="mb-0.5 h-7 object-contain object-left" />}
          <div className="border-t border-slate-400" />
          {d.signatoryName && <p className="text-[8px] font-bold">{d.signatoryName}</p>}
          {d.signatoryTitle && <p className="text-[7px] text-slate-500">{d.signatoryTitle}</p>}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0" style={{ height: 5, background: d.accentColor }} />
    </Frame>
  );
}

export const CARD_STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
  SUSPENDED: 'bg-yellow-100 text-yellow-900',
  REVOKED: 'bg-red-100 text-red-800',
  REPLACED: 'bg-slate-200 text-slate-700',
};

export function CardStatus({ value }: { value: string }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${CARD_STATUS_TONE[value] ?? 'bg-slate-100 text-slate-700'}`}>{value}</span>;
}
