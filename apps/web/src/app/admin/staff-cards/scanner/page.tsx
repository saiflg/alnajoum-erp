'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { VerificationPanel, Verification } from '@/components/staff-cards/VerificationPanel';
import { Badge, Field, Msg, PageTitle, Row, Table, btn, btnGhost, card, input, td, when } from '@/components/comm/ui';
import { ApiError, apiFileUrl, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { navForRoles } from '@/lib/nav-for-roles';
import { useApi } from '@/lib/use-api';

// BarcodeDetector is built into Chrome, Edge and Android browsers; it is not in TypeScript's DOM types yet. Where it is
// missing (Safari, Firefox) the same camera feed is decoded in the page with jsQR instead.
interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
type DetectorCtor = new (options?: { formats: string[] }) => Detector;
const detectorCtor = (): DetectorCtor | undefined => (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;

type Mode = 'camera' | 'manual' | 'usb';
type Method = 'QR' | 'MANUAL_STAFF_ID' | 'MANUAL_REFERENCE';

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many checks in a short time. Wait a minute and try again.';
    if (e.status === 401) return 'You have been signed out. Sign in again to keep scanning.';
    if (e.status === 403) return 'Your account is not allowed to verify cards.';
    return e.message;
  }
  return 'Could not reach the server. Check your connection and try the scan again — nothing was changed.';
}

function Scanner() {
  const [mode, setMode] = useState<Mode>('camera');
  const [result, setResult] = useState<Verification | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ method: Method; value: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const { data: history } = useApi<Row>('/staff-cards/scans?pageSize=8', refresh);

  const verify = useCallback(async (method: Method, value: string) => {
    setBusy(true);
    setFailure(null);
    setLast({ method, value });
    try {
      const v = await apiRequest<Verification>('/staff-cards/verify', { method: 'POST', body: { method, value } });
      setResult(v);
      setRefresh((n) => n + 1);
    } catch (e) {
      setResult(null);
      setFailure(describeFailure(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <PageTitle title="Card Scanner" subtitle="Check a staff identification card. Every result comes from our live records, never from the printed card or the QR code itself." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-4 flex gap-2" role="tablist" aria-label="How to check a card">
            {([['camera', 'Camera'], ['manual', 'Type it in'], ['usb', 'USB scanner']] as [Mode, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`rounded-md px-3 py-1.5 text-sm ${mode === k ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{label}</button>
            ))}
          </div>
          {mode === 'camera' && <CameraScan onCode={(code) => verify('QR', code)} paused={busy || !!result} />}
          {mode === 'manual' && <ManualEntry onSubmit={verify} busy={busy} />}
          {mode === 'usb' && <UsbScan onCode={(code) => verify('QR', code)} busy={busy} />}
        </div>

        <div aria-live="polite">
          {busy && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Checking…</p>}
          {failure && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <p className="font-semibold">The check did not complete</p>
              <p className="mt-1">{failure}</p>
              {last && <button className={`${btnGhost} mt-3`} onClick={() => verify(last.method, last.value)}>Try again</button>}
            </div>
          )}
          {result && !busy && (
            <>
              <VerificationPanel v={result} photoUrl={result.photoPath ? apiFileUrl(result.photoPath) : null} />
              <button className={`${btn} mt-3`} onClick={() => { setResult(null); setFailure(null); }}>Scan another card</button>
            </>
          )}
          {!busy && !result && !failure && <div className={`${card} text-sm text-slate-500`}>The result appears here. A card is only accepted when it shows <b>VALID — ACTIVE CARD</b>. Anything else: do not accept it as identification.</div>}
        </div>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold">Recent checks</h2>
      <Table head={['When', 'Result', 'How', 'Card']} empty={history && history.items.length === 0 ? 'No checks recorded yet.' : undefined}>
        {history?.items.map((s: Row) => (
          <tr key={s.id}>
            <td className={td}>{when(s.createdAt)}</td>
            <td className={td}><Badge value={s.result === 'VALID' ? 'OK' : s.result === 'INVALID' ? 'FAILED' : 'MEDIUM'} /> <span className="ml-1 text-xs">{s.result}</span></td>
            <td className={td}>{s.method.replace(/_/g, ' ').toLowerCase()}</td>
            <td className={td}>{s.cardNumber ?? <span className="text-slate-400">not recognised ({s.presented}…)</span>}</td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs"><Link className="text-amber-700 hover:underline" href="/admin/staff-cards/history">Full verification history →</Link></p>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ camera
/** The browser's own QR detector when it has one, otherwise a decoder that reads frames from a canvas. */
async function makeDecoder(): Promise<(v: HTMLVideoElement) => Promise<string | null>> {
  const Native = detectorCtor();
  if (Native) {
    const detector = new Native({ formats: ['qr_code'] });
    return async (v) => (await detector.detect(v))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  return async (v) => {
    if (!v.videoWidth) return null;
    const w = 480;
    const h = Math.max(1, Math.round((v.videoHeight / v.videoWidth) * w));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    return jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

function CameraScan({ onCode, paused }: { onCode: (code: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const handled = useRef('');
  const [state, setState] = useState<'idle' | 'starting' | 'running' | 'unsupported' | 'denied' | 'error'>('idle');
  const [detail, setDetail] = useState('');
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  async function start() {
    handled.current = '';
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setState('unsupported');
      setDetail(window.isSecureContext ? 'This browser cannot open a camera.' : 'Camera access needs a secure (HTTPS) connection.');
      return;
    }
    setState('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      const decode = await makeDecoder();
      setState('running');
      timer.current = window.setInterval(async () => {
        if (pausedRef.current || !video.current || video.current.readyState < 2) return;
        try {
          const code = await decode(video.current);
          // The same code held in front of the camera must not trigger a flood of checks.
          if (code && code !== handled.current) {
            handled.current = code;
            onCode(code);
          }
        } catch {
          /* a frame that cannot be read is simply skipped */
        }
      }, 300);
    } catch (e) {
      stop();
      const name = (e as { name?: string }).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setState('denied');
        setDetail('Camera permission was refused. Allow camera access for this site in the browser settings, then try again.');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setState('unsupported');
        setDetail('No camera was found on this device.');
      } else {
        setState('error');
        setDetail('The camera could not be started. Close other apps that may be using it and try again.');
      }
    }
  }

  return (
    <div className={card}>
      {state === 'running' || state === 'starting' ? (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={video} className="h-72 w-full object-cover" muted playsInline aria-label="Camera view" />
          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
          {state === 'starting' && <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white">Starting the camera…</p>}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          {state === 'idle' && <p className="text-sm text-slate-600">Point the camera at the QR code on the back or front of the card.</p>}
          {(state === 'unsupported' || state === 'denied' || state === 'error') && (
            <div role="alert" className="text-sm text-slate-700">
              <p className="font-semibold">{state === 'denied' ? 'Camera permission needed' : 'Camera scanning is not available here'}</p>
              <p className="mt-1">{detail}</p>
              <p className="mt-2 text-xs text-slate-500">You can still check a card: use <b>Type it in</b> (staff ID, card number or the verification link) or a <b>USB scanner</b>.</p>
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {state === 'running' || state === 'starting' ? (
          <button className={btnGhost} onClick={() => { stop(); setState('idle'); }}>Stop camera</button>
        ) : (
          <button className={btn} onClick={start}>{state === 'idle' ? 'Start camera' : 'Try the camera again'}</button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ manual
function ManualEntry({ onSubmit, busy }: { onSubmit: (m: Method, v: string) => void; busy: boolean }) {
  const [kind, setKind] = useState<Method>('MANUAL_STAFF_ID');
  const [value, setValue] = useState('');
  const labels: Record<Method, [string, string]> = {
    MANUAL_STAFF_ID: ['Staff ID', 'e.g. EMP-0042'],
    MANUAL_REFERENCE: ['Card number (verification reference)', 'e.g. ALN-C-7K3Q-9M2X'],
    QR: ['Verification link or code', 'paste the link from the QR code'],
  };
  return (
    <form className={`${card} space-y-3`} onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(kind, value.trim()); }}>
      <Field label="What do you have?">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value as Method)}>
          <option value="MANUAL_STAFF_ID">Staff ID</option>
          <option value="MANUAL_REFERENCE">Card number</option>
          <option value="QR">Verification link or code</option>
        </select>
      </Field>
      <Field label={labels[kind][0]}>
        <input className={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={labels[kind][1]} autoComplete="off" spellCheck={false} />
      </Field>
      <button className={btn} disabled={busy || !value.trim()}>Check card</button>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ USB scanner
function UsbScan({ onCode, busy }: { onCode: (code: string) => void; busy: boolean }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, [busy]);
  return (
    <div className={card}>
      <p className="mb-2 text-sm text-slate-600">An approved USB or Bluetooth barcode / QR scanner works like a keyboard: click the box below, then scan the card. The scanner &quot;types&quot; the code and presses Enter, and the check runs by itself.</p>
      <input
        ref={ref}
        className={`${input} font-mono`}
        value={value}
        placeholder="Click here, then scan the card"
        aria-label="Scanner input"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault();
            onCode(value.trim());
            setValue('');
          }
        }}
      />
      <p className="mt-2 text-xs text-slate-500">Nothing is stored from the scanner itself; only the result of the check is recorded.</p>
    </div>
  );
}

export default function ScannerPage() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'COMPANY_ADMIN', 'BRANCH_MANAGER', 'FINANCE_OFFICER', 'STAFF', 'AUDITOR']}>
      <AppShell title="Card Scanner" navLinks={navForRoles(user?.roles ?? [])}>
        <Scanner />
        <Msg />
      </AppShell>
    </ProtectedRoute>
  );
}
