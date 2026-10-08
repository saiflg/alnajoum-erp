'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, registerStepUpPrompt, requestStepUp } from '@/lib/api';

/**
 * Asks the signed-in person to confirm their password (and authenticator code, if they use one) before a
 * sensitive action. Mounted once; lib/api.ts calls it whenever the server answers STEP_UP_REQUIRED and then
 * retries the original request with the short-lived proof it obtains.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<((ok: boolean) => void) | null>(null);

  const prompt = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        // A second request arriving while the dialog is open shares the same answer.
        const previous = pending.current;
        pending.current = (ok) => {
          previous?.(ok);
          resolve(ok ? 'ok' : null);
        };
        setPassword('');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    registerStepUpPrompt(prompt);
    return () => registerStepUpPrompt(null);
  }, [prompt]);

  function finish(ok: boolean) {
    setOpen(false);
    setPassword('');
    const resolve = pending.current;
    pending.current = null;
    resolve?.(ok);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestStepUp(password);
      finish(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm your identity');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="step-up-title"
        >
          <form onSubmit={submit} className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h2 id="step-up-title" className="text-base font-semibold text-slate-900">
              Confirm it&apos;s you
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              This action is sensitive. Enter your password (or your authenticator code if you have two-factor
              turned on) to continue. The confirmation lasts five minutes.
            </p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Password or authenticator code"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => finish(false)}
                className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || password.length === 0}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
