'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Verification } from '@/components/staff-cards/VerificationPanel';
import { Badge, Field, Row, btn, btnGhost, card, input } from '@/components/comm/ui';
import { ApiError, apiRequest } from '@/lib/api';
import { ADAPTER_HELP, NfcAdapter, NfcRead, keyboardWedgeAdapter, mockAdapter, webNfcAdapter } from '@/lib/nfc/readers';
import { useApi } from '@/lib/use-api';

type ClientKind = 'WEB_NFC' | 'KEYBOARD_WEDGE' | 'MOCK';

function failure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Too many checks in a short time. Wait a minute and try again.';
    if (e.status === 401) return 'You have been signed out. Sign in again to keep scanning.';
    if (e.status === 403) return 'Your account is not allowed to verify cards.';
    return e.message;
  }
  return 'VERIFICATION SERVICE UNAVAILABLE — could not reach the server. Do not accept the card until it has been checked.';
}

/**
 * "Tap NFC card": reads a chip through one of the reader adapters and asks the server about it. What the chip says about
 * itself is never trusted; the answer always comes from the card record. The mock reader is plainly labelled and every
 * result it produces is marked SIMULATED.
 */
export function NfcTap({ onResult, onFailure, onBusy, paused }: { onResult: (v: Verification) => void; onFailure: (message: string) => void; onBusy: (busy: boolean) => void; paused: boolean }) {
  const { data: readers } = useApi<Row[]>('/nfc/readers');
  const [kind, setKind] = useState<ClientKind>('WEB_NFC');
  const [readerId, setReaderId] = useState('');
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string }>({ tone: 'warn', text: 'Not listening.' });
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [both, setBoth] = useState(false);
  const [qr, setQr] = useState('');
  const [nfcValue, setNfcValue] = useState('');
  const [mockInput, setMockInput] = useState('');
  const adapterRef = useRef<ReturnType<typeof mockAdapter> | NfcAdapter | null>(null);
  const pausedRef = useRef(paused);
  // Keep the latest value where the reader's callback can see it, without touching the ref while rendering.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const adapter = useMemo<NfcAdapter | (NfcAdapter & { trigger(p: string): void })>(() => (kind === 'WEB_NFC' ? webNfcAdapter() : kind === 'KEYBOARD_WEDGE' ? keyboardWedgeAdapter() : mockAdapter()), [kind]);
  const availability = adapter.availability();
  const candidates = (readers ?? []).filter((r) => r.adapter === kind && r.isActive);
  const bridgeReaders = (readers ?? []).filter((r) => ['PCSC_BRIDGE', 'VENDOR_SDK', 'ANDROID_APP'].includes(r.adapter) && r.isActive);

  const report = useCallback(async (state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR', error?: string) => {
    if (!readerId) return;
    try {
      await apiRequest(`/nfc/readers/${readerId}/report`, { method: 'POST', body: { status: state, error } });
    } catch {
      /* status reporting is best effort */
    }
  }, [readerId]);

  const check = useCallback(async (payload: string | null, serial: string | null, simulated: boolean, qrValue?: string) => {
    onBusy(true);
    try {
      let v: Verification;
      if (qrValue && payload) v = await apiRequest<Verification>('/nfc/verify-both', { method: 'POST', body: { qr: qrValue, nfc: payload, readerId: readerId || undefined, simulated: simulated || undefined } });
      else if (payload) v = await apiRequest<Verification>('/nfc/verify', { method: 'POST', body: { payload, readerId: readerId || undefined, simulated: simulated || undefined } });
      else if (serial) v = await apiRequest<Verification>('/nfc/verify-uid', { method: 'POST', body: { uid: serial, readerId: readerId || undefined, simulated: simulated || undefined } });
      else {
        onFailure('READER ERROR — the card was detected but held nothing readable. Try again, or check it another way.');
        return;
      }
      onResult(v);
    } catch (e) {
      onFailure(failure(e));
    } finally {
      onBusy(false);
    }
  }, [onBusy, onFailure, onResult, readerId]);

  const handleRead = useCallback((r: NfcRead) => {
    if (pausedRef.current) return;
    setLastRead(r.payload ?? (r.serial ? `serial ${r.serial}` : 'unreadable card'));
    if (both) {
      setNfcValue(r.payload ?? '');
      return;
    }
    void check(r.payload, r.serial, r.simulated);
  }, [both, check]);

  const stop = useCallback(() => {
    adapterRef.current?.stop();
    adapterRef.current = null;
    setListening(false);
    setStatus({ tone: 'warn', text: 'Not listening.' });
    void report('DISCONNECTED');
  }, [report]);

  const start = useCallback(async () => {
    adapterRef.current?.stop();
    try {
      await adapter.start(handleRead, (message) => {
        setStatus({ tone: 'err', text: message });
        void report('ERROR', message);
      });
      adapterRef.current = adapter;
      setListening(true);
      setStatus({ tone: 'ok', text: kind === 'MOCK' ? 'Mock reader ready (simulation only).' : 'Listening — present a card.' });
      void report('CONNECTED');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not start the reader.';
      setListening(false);
      setStatus({ tone: 'err', text: message });
      void report('ERROR', message);
    }
  }, [adapter, handleRead, kind, report]);

  useEffect(() => () => adapterRef.current?.stop(), []);
  // Changing the reader type stops the previous one.
  useEffect(() => {
    adapterRef.current?.stop();
    adapterRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the visible state to match the stopped reader
    setListening(false);
    setReaderId('');
    setLastRead(null);
  }, [kind]);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reader type">
            <select className={input} value={kind} onChange={(e) => setKind(e.target.value as ClientKind)}>
              <option value="WEB_NFC">This phone (Web NFC)</option>
              <option value="KEYBOARD_WEDGE">USB reader that types</option>
              <option value="MOCK">MOCK reader (tests only)</option>
            </select>
          </Field>
          <Field label="Registered reader (optional)" hint="Choose one so its taps and status are recorded against it.">
            <select className={input} value={readerId} onChange={(e) => setReaderId(e.target.value)}>
              <option value="">— none —</option>
              {candidates.map((r) => <option key={r.id} value={r.id}>{r.name}{r.model ? ` (${r.model})` : ''}</option>)}
            </select>
          </Field>
        </div>
        <p className={`rounded-md p-2 text-xs ${availability.ok ? 'bg-slate-50 text-slate-600' : 'bg-amber-50 text-amber-900'}`}>{availability.reason}</p>
        {kind === 'MOCK' && <p className="rounded-md border border-sky-300 bg-sky-50 p-2 text-xs font-semibold text-sky-900">MOCK READER: nothing here reads a real card. Results are marked SIMULATED.</p>}
        <div className="flex flex-wrap items-center gap-3">
          {!listening ? <button className={btn} disabled={!availability.ok || paused} onClick={start}>Start listening</button> : <button className={btnGhost} onClick={stop}>Stop</button>}
          <span className={`text-xs ${status.tone === 'ok' ? 'text-emerald-700' : status.tone === 'err' ? 'font-medium text-red-700' : 'text-slate-500'}`} role={status.tone === 'err' ? 'alert' : 'status'}>{status.text}</span>
        </div>
        {lastRead && <p className="text-xs text-slate-500">Last card detected: <span className="font-mono">{lastRead.length > 48 ? `${lastRead.slice(0, 48)}…` : lastRead}</span></p>}
        {kind === 'MOCK' && (
          <div className="flex gap-2">
            <input className={`${input} font-mono text-xs`} placeholder="Paste a card address to simulate tapping it" value={mockInput} onChange={(e) => setMockInput(e.target.value)} />
            <button className={btnGhost} disabled={!listening || !mockInput.trim()} onClick={() => (adapter as ReturnType<typeof mockAdapter>).trigger(mockInput.trim())}>Simulate tap</button>
          </div>
        )}
      </div>

      <div className={`${card} space-y-3`}>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={both} onChange={(e) => { setBoth(e.target.checked); setNfcValue(''); }} /> Check the QR code and the NFC chip together</label>
        {both && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Scan or paste the QR code, then tap the card. Both must lead to the same card.</p>
            <Field label="QR code or link"><input className={`${input} font-mono text-xs`} value={qr} onChange={(e) => setQr(e.target.value)} placeholder="Scan the QR code with a USB scanner, or paste it" /></Field>
            <Field label="NFC chip (filled in by the tap)"><input className={`${input} font-mono text-xs`} value={nfcValue} onChange={(e) => setNfcValue(e.target.value)} /></Field>
            <button className={btn} disabled={paused || !qr.trim() || !nfcValue.trim()} onClick={() => void check(nfcValue.trim(), null, kind === 'MOCK', qr.trim())}>Check both</button>
          </div>
        )}
      </div>

      {bridgeReaders.length > 0 && (
        <div className={`${card} text-xs text-slate-600`}>
          <p className="font-medium text-slate-800">Readers connected through the local bridge</p>
          <ul className="mt-1 space-y-1">{bridgeReaders.map((r) => <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.name} · {r.location ?? 'no location'}</span><Badge value={r.status} /></li>)}</ul>
          <p className="mt-2 text-slate-400">{ADAPTER_HELP.PCSC_BRIDGE} Their taps are checked by the bridge itself and show in the history below.</p>
        </div>
      )}
    </div>
  );
}
