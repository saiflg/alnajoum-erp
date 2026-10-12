import { apiFileUrl } from './api';

export class PublicApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Calls a public (signed-out) endpoint. It never sends cookies and never tries to refresh a session: the pages that
 * use it are opened from links in messages, often on a phone that is not signed in to anything.
 */
export async function publicRequest<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(apiFileUrl(path), {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(payload?.message) ? payload.message.join(' ') : payload?.message;
    throw new PublicApiError(
      res.status === 429 ? 'Too many attempts. Please wait a minute and try again.' : (msg ?? 'Something went wrong. Please try again.'),
      res.status,
    );
  }
  return payload.data as T;
}
