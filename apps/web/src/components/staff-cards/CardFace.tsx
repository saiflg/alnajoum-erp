'use client';

/* eslint-disable @next/next/no-img-element -- the card images are data URLs produced by the API, not optimisable assets */
import { fmtDate } from '@/components/comm/ui';
import { inkOnWhite, mix, onColor } from '@/lib/card-colours';

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

// The card is laid out in PDF points (the same coordinates the API uses to draw the PDF) inside a stage that is
// scaled up to screen size, so the preview and the printed card match. CR80 proportions (85.6 x 54 mm).
const W = 342;
const H = 216;
const PW = 242.65; // card width in points
const PH = 153; // card height in points
const SCALE = W / PW;

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

const FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';
const line1 = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
const box = (left: number, top: number, width?: number, height?: number): React.CSSProperties => ({ position: 'absolute', left, top, width, height });
const disc = (cx: number, cy: number, r: number, background: string, opacity = 1): React.CSSProperties => ({
  position: 'absolute',
  left: cx - r,
  top: cy - r,
  width: r * 2,
  height: r * 2,
  borderRadius: '50%',
  background,
  opacity,
});

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      aria-label={label}
      className="relative overflow-hidden rounded-xl bg-white text-slate-900 shadow-md ring-1 ring-slate-300 print:shadow-none"
      style={{ width: W, height: H }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, width: PW, height: PH, transform: `scale(${SCALE})`, transformOrigin: 'top left', fontFamily: FONT, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

/** The logo on a white disc ringed in the accent colour. */
function LogoDisc({ src, cx, cy, r, ring }: { src: string; cx: number; cy: number; r: number; ring: string }) {
  return (
    <>
      <div style={disc(cx, cy, r + 1.4, ring)} />
      <div style={{ ...disc(cx, cy, r, '#ffffff'), overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={src} alt="" style={{ width: (r - 2) * 2, height: (r - 2) * 2, objectFit: 'contain' }} />
      </div>
    </>
  );
}

function Watermark({ src, cx, cy, size }: { src: string | null; cx: number; cy: number; size: number }) {
  if (!src) return null;
  return <img src={src} alt="" aria-hidden="true" style={{ ...box(cx - size / 2, cy - size / 2, size, size), objectFit: 'contain', opacity: 0.07, pointerEvents: 'none' }} />;
}

const tileShadow = '0.8px 1.6px 2px rgba(0,0,0,0.3)';

export function CardFront({ c }: { c: CardPreviewData }) {
  const d = c.design;
  const dark = mix(d.primaryColor, '#000000', 0.45);
  const onP = onColor(d.primaryColor);
  const onA = onColor(d.accentColor);
  const ink = inkOnWhite(d.primaryColor);
  const hx = c.logoDataUrl ? 141 : 113;
  const titleSize = Math.max(5.8, Math.min(8.2, (233 - hx) / (Math.max(d.displayName.length, 1) * 0.7)));
  return (
    <Frame label={`Front of the identification card of ${c.fullName}`}>
      <div style={disc(238, -4, 56, d.primaryColor, 0.07)} />
      <div style={disc(206, 156, 44, d.accentColor, 0.07)} />
      <Watermark src={c.logoDataUrl} cx={170} cy={88} size={96} />

      {/* side panel with a slanted edge, and the accent stripe beside it */}
      <div style={{ ...box(0, 0, 98, PH), background: `linear-gradient(158.6deg, ${d.primaryColor}, ${dark})`, clipPath: 'polygon(0 0, 98px 0, 78px 153px, 0 153px)', overflow: 'hidden' }}>
        <div style={disc(8, 150, 48, '#ffffff', 0.09)} />
        <div style={disc(64, -6, 30, '#ffffff', 0.09)} />
      </div>
      <div style={{ ...box(0, 0, 104, PH), background: d.accentColor, clipPath: 'polygon(98px 0, 104px 0, 84px 153px, 78px 153px)' }} />

      {/* photograph in a white frame */}
      <div style={{ ...box(12, 16, 56, 70), background: '#fff', borderRadius: 7, boxShadow: tileShadow }} />
      <div style={{ ...box(14, 18, 52, 66), borderRadius: 5.5, overflow: 'hidden', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {c.photoDataUrl ? (
          <img src={c.photoDataUrl} alt={`Photograph of ${c.fullName}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 20, fontWeight: 700, color: '#64748b' }}>{initials(c.fullName)}</span>
        )}
      </div>

      <div style={{ ...box(14, 94), fontSize: 5, color: onP, opacity: 0.75 }}>STAFF ID</div>
      <div style={{ ...box(14, 101, 66), ...line1, fontSize: 9.5, fontWeight: 700, color: onP, lineHeight: '11px' }}>{c.employeeCode}</div>
      <div style={{ ...box(14, 120), fontSize: 5, color: onP, opacity: 0.75 }}>CARD NO.</div>
      <div style={{ ...box(14, 127, 64), ...line1, fontSize: 6.2, fontWeight: 700, color: onP, lineHeight: '8px' }}>{c.cardNumber}</div>

      {/* company header */}
      {c.logoDataUrl && <LogoDisc src={c.logoDataUrl} cx={125} cy={21} r={11} ring={d.accentColor} />}
      <div style={{ ...box(hx, d.tagline ? 12 : 17, 233 - hx), ...line1, fontSize: titleSize, fontWeight: 700, color: ink, lineHeight: '10px', textTransform: 'uppercase' }}>{d.displayName}</div>
      {d.tagline && <div style={{ ...box(hx, 23, 233 - hx), ...line1, fontSize: 5.4, color: '#64748b', lineHeight: '7px' }}>{d.tagline}</div>}
      <div style={{ ...box(113, 37.75, 120, 0.5), background: mix(d.accentColor, '#ffffff', 0.35) }} />
      <div style={{ ...box(113, 37.1, 24, 1.8), background: ink }} />

      {/* identity */}
      <div style={{ ...box(113, 44, 120), display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', lineHeight: '14.4px', maxHeight: 29, overflow: 'hidden' }}>{c.fullName}</div>
        {c.jobTitle && (
          <div style={{ marginTop: 3, alignSelf: 'flex-start', maxWidth: 120, height: 10, padding: '0 6px', borderRadius: 5, background: d.accentColor, color: onA, fontSize: 6.2, fontWeight: 700, lineHeight: '10px', ...line1 }}>{c.jobTitle}</div>
        )}
        <div style={{ marginTop: 5 }}>
          {([['DEPT', c.department], ['BRANCH', c.branchName]] as const).filter(([, v]) => !!v).map(([label, value]) => (
            <div key={label} style={{ position: 'relative', height: 9.5, paddingLeft: 7, lineHeight: '9.5px', maxWidth: 71, display: 'flex', gap: 3, alignItems: 'baseline', ...line1 }}>
              <span style={{ position: 'absolute', left: 0.4, top: 3.4, width: 2.6, height: 2.6, borderRadius: '50%', background: d.primaryColor }} />
              <span style={{ fontSize: 4.8, color: '#64748b', flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 6.8, color: '#334155', ...line1 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* dates */}
      <div style={{ ...box(113, 136), fontSize: 5, color: '#64748b' }}>ISSUED</div>
      <div style={{ ...box(154, 136), fontSize: 5, color: '#64748b' }}>EXPIRES</div>
      <div style={{ ...box(113, 142.5), fontSize: 6.4, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>{fmtDate(c.issuedAt)}</div>
      <div style={{ ...box(154, 142.5), fontSize: 6.4, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>{fmtDate(c.expiresAt)}</div>

      {/* QR code on a white tile */}
      <div style={{ ...box(186, 88, 48, 48), boxSizing: 'border-box', background: '#fff', border: `0.8px solid ${d.accentColor}`, borderRadius: 5, boxShadow: tileShadow }}>
        {c.qrDataUrl && <img src={c.qrDataUrl} alt="QR code that verifies this card" style={{ position: 'absolute', left: 2.2, top: 2.2, width: 42, height: 42 }} />}
      </div>
      <div style={{ ...box(186, 138.5, 48), textAlign: 'center', fontSize: 4.8, color: '#64748b' }}>Scan to verify</div>

      <div style={{ ...box(0, PH - 3.5, PW, 3.5), background: `linear-gradient(90deg, ${dark}, ${d.primaryColor}, ${d.accentColor})` }} />
      {c.status === 'PENDING' && (
        <div className="print:hidden" style={{ ...box(150, 66), transform: 'rotate(6deg)', border: '1.5px solid #d97706', color: '#b45309', fontSize: 7, fontWeight: 700, textTransform: 'uppercase', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.85)' }}>Not yet activated</div>
      )}
    </Frame>
  );
}

export function CardBack({ c }: { c: CardPreviewData }) {
  const d = c.design;
  const dark = mix(d.primaryColor, '#000000', 0.45);
  const onP = onColor(d.primaryColor);
  const ink = inkOnWhite(d.primaryColor);
  const contact = [d.contactPhone, d.contactEmail, d.website, d.contactAddress].filter((v): v is string => !!v);
  const contactLines: string[] = [];
  if (contact.length >= 1) contactLines.push(contact.slice(0, 2).join('   ·   '));
  if (contact.length >= 3) contactLines.push(contact.slice(2).join('   ·   '));
  const hx = c.logoDataUrl ? 36 : 12;
  const para = { fontSize: 5.7, lineHeight: '6.6px', color: '#334155', marginBottom: 2.6 } as const;
  const bullet = (extra: React.CSSProperties = {}) => ({ ...para, position: 'relative' as const, paddingLeft: 6, ...extra });
  const dot = <span style={{ position: 'absolute', left: 0.8, top: 2, width: 2.4, height: 2.4, borderRadius: '50%', background: d.accentColor }} />;
  return (
    <Frame label={`Back of the identification card of ${c.fullName}`}>
      <div style={disc(-6, 150, 46, d.accentColor, 0.07)} />
      <div style={disc(240, 130, 40, d.primaryColor, 0.07)} />
      <Watermark src={c.logoDataUrl} cx={121} cy={92} size={104} />

      {/* header band, cut on the slant */}
      <div style={{ ...box(0, 0, PW, 35), background: `linear-gradient(90deg, ${d.primaryColor}, ${dark})`, clipPath: 'polygon(0 0, 100% 0, 100% 18px, 0 31px)' }} />
      <div style={{ ...box(0, 0, PW, 35), background: d.accentColor, clipPath: 'polygon(0 31px, 100% 18px, 100% 21.5px, 0 34.5px)' }} />
      {c.logoDataUrl && <LogoDisc src={c.logoDataUrl} cx={21} cy={13} r={8} ring={d.accentColor} />}
      <div style={{ ...box(hx, 9.5, PW - hx - 12), ...line1, fontSize: 7.4, fontWeight: 700, color: onP, lineHeight: '9px', textTransform: 'uppercase' }}>{d.displayName}</div>

      <div style={{ ...box(12, 41, 146) }}>
        <p style={para}>This card is the property of {d.displayName}. It identifies the holder as a member of staff, must be shown on request and may not be lent to anyone else.</p>
        <p style={{ ...para, fontWeight: 700, color: '#0f172a' }}>{d.lostCardNotice}</p>
        {contactLines.map((l) => (
          <p key={l} style={bullet({ marginBottom: 2 })}>{dot}{l}</p>
        ))}
        {d.emergencyContact && <p style={bullet({ fontWeight: 700 })}>{dot}Emergency: {d.emergencyContact}</p>}
        {d.officialRegistrationLine && <p style={{ ...para, color: '#64748b' }}>{d.officialRegistrationLine}</p>}
      </div>

      {(d.signatoryName || c.signatureDataUrl) && (
        <>
          {c.signatureDataUrl && <img src={c.signatureDataUrl} alt="Authorised signature" style={{ ...box(12, 110, 62, 22), objectFit: 'contain', objectPosition: 'left bottom' }} />}
          <div style={{ ...box(12, 132.8, 66, 0.5), background: '#94a3b8' }} />
          {d.signatoryName && <div style={{ ...box(12, 134.6, 100), ...line1, fontSize: 5.6, fontWeight: 700, color: '#0f172a', lineHeight: '7px' }}>{d.signatoryName}</div>}
          {d.signatoryTitle && <div style={{ ...box(12, 141.4, 100), ...line1, fontSize: 5.2, color: '#64748b', lineHeight: '6px' }}>{d.signatoryTitle}</div>}
        </>
      )}

      <div style={{ ...box(174, 44, 58, 58), boxSizing: 'border-box', background: '#fff', border: `0.8px solid ${d.accentColor}`, borderRadius: 5, boxShadow: tileShadow }}>
        {c.qrDataUrl && <img src={c.qrDataUrl} alt="QR code that verifies this card" style={{ position: 'absolute', left: 3.2, top: 3.2, width: 50, height: 50 }} />}
      </div>
      <div style={{ ...box(168, 106, 70), textAlign: 'center', fontSize: 5, lineHeight: '5.8px', color: '#64748b' }}>Scan to confirm this card is genuine and still valid.</div>
      <div style={{ ...box(168, 123, 70), textAlign: 'center', fontSize: 6.2, fontWeight: 700, color: ink, lineHeight: '8px' }}>{c.cardNumber}</div>

      <div style={{ ...box(0, PH - 3.5, PW, 3.5), background: `linear-gradient(90deg, ${d.accentColor}, ${d.primaryColor}, ${dark})` }} />
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
