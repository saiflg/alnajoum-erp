const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  retryOn401?: boolean;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(payload?.message ?? res.statusText, res.status);
  }

  return payload.data as T;
}

/** Wraps rawRequest with a single silent refresh-and-retry on a 401. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const retryOn401 = options.retryOn401 ?? true;
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
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
