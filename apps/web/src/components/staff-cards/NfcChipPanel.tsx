'use client';

import { useState } from 'react';
import { Badge, Field, Msg, Row, btn, btnGhost, card, input, useAction } from '@/components/comm/ui';
import { apiRequest } from '@/lib/api';
import { webNfcAdapter } from '@/lib/nfc/readers';
import { useApi } from '@/lib/use-api';

const STATUS_TEXT: Record<string, string> = {
  PREPARED: 'Prepared — not written yet',
  ENCODED: 'Written — not confirmed',
  VERIFIED: 'Written and confirmed',
  FAILED: 'Writing failed',
};

/**
 * The NFC chip of one card: prepare the chip's reference, write it with a compatible reader or phone, read it back,
 * and confirm. The card cannot be activated until the chip is confirmed. Nothing personal is written to the chip.
 */
export function NfcChipPanel({ cardId, effective, canManage, onChange }: { cardId: string; effective: string; canManage: boolean; onChange: () => void }) {
  const [refresh, setRefresh] = useState(0);
  const { data: s, error } = useApi<Row>(`/nfc/cards/${cardId}`, refresh);
  const { data: profiles } = useApi<Row[]>(canManage ? '/nfc/profiles' : null);
  const [profileId, setProfileId] = useState('');
  const [batch, setBatch] = useState('');
  const [recordUid, setRecordUid] = useState(false);
  const [plan, setPlan] = useState<Row | null>(null);
  const [pasted, setPasted] = useState('');
  const [uid, setUid] = useState<string | null>(null);
  const { act, error: actionError, notice, busy } = useAction(() => { setRefresh((n) => n + 1); onChange(); });
  const web = webNfcAdapter();
  const webOk = web.availability().ok;
  const editable = canManage && ['PENDING', 'ACTIVE'].includes(effective);

  const confirm = (body: Row, done: string) => act(async () => {
    const r = await apiRequest<Row>(`/nfc/cards/${cardId}/confirm`, { method: 'POST', body: { ...body, recordUid: recordUid || undefined, uid: uid ?? undefined } });
    if (r.status === 'FAILED') throw new Error(r.reason ?? 'The chip could not be confirmed.');
    setPlan(null);
    setPasted('');
  }, done);

  /** Reads one tag with the phone and returns what it holds. */
  const readOnce = () => new Promise<{ payload: string | null; serial: string | null }>((resolve, reject) => {
    web.start((r) => { web.stop(); resolve({ payload: r.payload, serial: r.serial }); }, (m) => { web.stop(); reject(new Error(m)); }).catch(reject);
  });

  return (
    <div className={card}>
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">NFC chip</h2>{s?.present && <Badge value={s.status} />}</div>
      <Msg error={error ?? actionError} notice={notice} />

      {!s ? <p className="mt-2 text-xs text-slate-500">Loading…</p> : !s.present && !plan ? (
        <div className="mt-2 space-y-2 text-xs text-slate-600">
          <p>No NFC chip has been prepared for this card. A QR-only card works without one.</p>
          {editable && (
            <>
              <Field label="Chip and card type"><select className={input} value={profileId} onChange={(e) => setProfileId(e.target.value)}><option value="">Default profile</option>{profiles?.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.capability?.label}</option>)}</select></Field>
              <Field label="Issuance batch (optional)"><input className={input} value={batch} onChange={(e) => setBatch(e.target.value)} maxLength={60} /></Field>
              <label className="flex items-start gap-2"><input className="mt-0.5" type="checkbox" checked={recordUid} onChange={(e) => setRecordUid(e.target.checked)} /><span>Also record the chip&apos;s serial number (as a one-way fingerprint). Lets a reader that only sees the serial number find the card, but that is a weak check.</span></label>
              <button className={btn} disabled={busy} onClick={() => act(async () => { setPlan(await apiRequest<Row>(`/nfc/cards/${cardId}/prepare`, { method: 'POST', body: { profileId: profileId || undefined, batch: batch || undefined, recordUid } })); }, 'Chip prepared. Now write it.')}>Prepare NFC chip</button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-3 text-xs text-slate-600">
          <p>{STATUS_TEXT[s?.status ?? 'PREPARED']}{s?.batch ? ` · batch ${s.batch}` : ''}{s?.serialRecorded ? ` · serial ${s.serialHint}` : ''}</p>
          {s?.failureReason && <p className="rounded bg-red-50 p-2 text-red-700">{s.failureReason}</p>}
          {s?.status === 'VERIFIED' && <p className="rounded bg-emerald-50 p-2 text-emerald-800">The chip holds this card&apos;s reference and was read back correctly. It now verifies together with the QR code.</p>}

          {plan && (
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <p className="font-medium text-slate-800">Write this to the chip ({plan.chip.label})</p>
              <ol className="list-decimal space-y-1 pl-4">{plan.instructions.map((i: string) => <li key={i}>{i}</li>)}</ol>
              <Field label="Address to write (an NDEF URI record)"><input readOnly className={`${input} font-mono text-[11px]`} value={plan.url} onFocus={(e) => e.currentTarget.select()} /></Field>
              <p className="text-[11px] text-slate-400">{plan.plan.bytes} bytes{plan.plan.fits === true ? ', fits this chip' : plan.plan.fits === null ? ', chip size unknown: check it fits' : ''}. Raw bytes (hex): <span className="break-all font-mono">{plan.plan.ndefHex}</span></p>
              {plan.chip.warning && <p className="rounded bg-amber-50 p-2 text-amber-900">{plan.chip.warning}</p>}

              <div className="space-y-2 border-t border-slate-100 pt-2">
                <p className="font-medium text-slate-800">1. Write and read back</p>
                {webOk ? (
                  <button className={btn} disabled={busy} onClick={() => act(async () => {
                    await web.write!(plan.url);
                    const read = await readOnce();
                    setUid(read.serial);
                    await confirm({ success: !!read.payload, readBack: read.payload ?? undefined, uid: read.serial ?? undefined, error: read.payload ? undefined : 'Nothing readable on the chip after writing.' }, 'Chip written and confirmed.');
                  })}>Write with this phone, then hold the same card again to read it back</button>
                ) : <p className="rounded bg-slate-50 p-2">{web.availability().reason}</p>}
                <p className="font-medium text-slate-800">2. Or: I wrote it with another tool</p>
                <Field label="What the chip held when read back (the address, or just the reference)"><input className={`${input} font-mono text-[11px]`} value={pasted} onChange={(e) => setPasted(e.target.value)} /></Field>
                <div className="flex flex-wrap gap-2">
                  <button className={btn} disabled={busy || !pasted.trim()} onClick={() => confirm({ success: true, readBack: pasted.trim() }, 'Chip confirmed.')}>Confirm what I read back</button>
                  <button className={btnGhost} disabled={busy} onClick={() => confirm({ success: false, error: 'The writer reported that writing failed.' }, 'Failure recorded.')}>Writing failed</button>
                </div>
                {process.env.NODE_ENV !== 'production' && (
                  <button className={`${btnGhost} border-sky-300 text-sky-800`} disabled={busy} onClick={() => confirm({ success: true, readBack: plan.url, simulated: true }, 'SIMULATED confirmation recorded (test only).')}>MOCK: pretend it was written (test only)</button>
                )}
              </div>
            </div>
          )}

          {editable && s?.status !== 'VERIFIED' && !plan && (
            <button className={btnGhost} disabled={busy} onClick={() => act(async () => { setPlan(await apiRequest<Row>(`/nfc/cards/${cardId}/prepare`, { method: 'POST', body: { batch: s?.batch ?? undefined, recordUid } })); }, 'A new reference was prepared; the old one no longer works.')}>Start again with a new reference</button>
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-400">A card with an NFC chip is activated only after its chip is confirmed. If the card is suspended, revoked, expired or replaced, the chip stops verifying at once — the chip never decides.</p>
    </div>
  );
}
