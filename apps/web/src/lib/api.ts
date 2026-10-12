const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Machine-readable code from the server, e.g. STEP_UP_REQUIRED. */
    public code?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- step-up
// Sensitive actions (money movement, role changes, backups, ...) need a fresh proof of identity on top of the
// session. The server answers 403 STEP_UP_REQUIRED; a registered prompt (see StepUpProvider) asks the person for
// their password, exchanges it for a short-lived proof, and the request is retried once with it.
export const STEP_UP_HEADER = 'x-step-up-token';
let stepUpProof: { token: string; expiresAt: number } | null = null;
let stepUpPrompt: (() => Promise<string | null>) | null = null;

export function registerStepUpPrompt(prompt: (() => Promise<string | null>) | null): void {
  stepUpPrompt = prompt;
}

/** Exchanges the person's password (or 2FA code) for a 5-minute proof and remembers it in memory only. */
export async function requestStepUp(secret: string): Promise<void> {
  // The server checks the authenticator/recovery code for people with two-factor on, and the password for
  // everyone else, so the one field the person typed is offered as both.
  const res = await rawRequest<{ stepUpToken: string; expiresInSeconds: number }>('/security/step-up', {
    method: 'POST',
    body: { password: secret, code: secret },
  });
  stepUpProof = { token: res.stepUpToken, expiresAt: Date.now() + Math.max(0, res.expiresInSeconds - 10) * 1000 };
}

function stepUpHeaders(): Record<string, string> {
  return stepUpProof && stepUpProof.expiresAt > Date.now() ? { [STEP_UP_HEADER]: stepUpProof.token } : {};
}

/** Forget the proof (called on sign-out). */
export function clearStepUp(): void {
  stepUpProof = null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  retryOn401?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...stepUpHeaders() },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(payload?.message ?? res.statusText, res.status, payload?.code);
  }

  return payload.data as T;
}

/** Wraps rawRequest with a single silent refresh-and-retry on a 401, and one step-up prompt-and-retry. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const retryOn401 = options.retryOn401 ?? true;
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'STEP_UP_REQUIRED' && stepUpPrompt) {
      const proved = await stepUpPrompt();
      if (!proved) throw error;
      return rawRequest<T>(path, options);
    }
    if (error instanceof ApiError && error.status === 401 && retryOn401) {
      try {
        await rawRequest('/auth/refresh', { method: 'POST' });
      } catch {
        throw error;
      }
      return rawRequest<T>(path, { ...options, retryOn401: false });
    }
    throw error;
  }
}

async function rawUpload<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(payload?.message ?? res.statusText, res.status);
  }

  return payload.data as T;
}

/** Uploads a file as multipart/form-data, with a single refresh-and-retry on 401. */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  try {
    return await rawUpload<T>(path, file);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await rawRequest('/auth/refresh', { method: 'POST' });
      return rawUpload<T>(path, file);
    }
    throw error;
  }
}

/** Absolute URL for direct browser navigation (relies on the shared auth cookie). */
export function apiFileUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * Downloads a protected file through fetch (so the step-up proof header can be sent, which a plain link cannot),
 * then hands it to the browser as a save-as.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const get = () => fetch(`${API_BASE}${path}`, { credentials: 'include', headers: stepUpHeaders() });
  let res = await get();
  if (res.status === 403 && stepUpPrompt) {
    const payload = await res.clone().json().catch(() => null);
    if (payload?.code === 'STEP_UP_REQUIRED' && (await stepUpPrompt())) res = await get();
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(payload?.message ?? res.statusText, res.status, payload?.code);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetches a protected PDF (GET, or POST with a JSON body) and opens it in a new tab for viewing or printing; falls back
 * to a download if the browser blocks the tab.
 */
export async function apiOpenPdf(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; filename?: string } = {}): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...stepUpHeaders() },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(payload?.message ?? res.statusText, res.status, payload?.code);
  }
  const url = URL.createObjectURL(await res.blob());
  if (!window.open(url, '_blank')) {
    const a = document.createElement('a');
    a.href = url;
    a.download = options.filename ?? 'document.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
