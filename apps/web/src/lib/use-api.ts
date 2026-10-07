'use client';

import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from './api';

interface Loaded<T> {
  key: string;
  data?: T;
  error?: string;
}

/**
 * Fetch keyed by path (and an optional refresh counter). "Loading" is simply "the stored result is
 * for a different key", so no state is set synchronously inside the effect; a response that arrives
 * after the key changed is ignored.
 */
export function useApi<T>(path: string | null, refresh = 0): { data?: T; error?: string; loading: boolean } {
  const [result, setResult] = useState<Loaded<T> | null>(null);
  const key = path === null ? null : `${path}#${refresh}`;

  useEffect(() => {
    if (path === null || key === null) return;
    let cancelled = false;
    apiRequest<T>(path)
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((err) => !cancelled && setResult({ key, error: err instanceof ApiError ? err.message : 'Request failed' }));
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const current = result && result.key === key ? result : null;
  return { data: current?.data, error: current?.error, loading: key !== null && current === null };
}

/** The message from a failed call, with the server's validation detail when it gave one. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : 'Something went wrong';
}
