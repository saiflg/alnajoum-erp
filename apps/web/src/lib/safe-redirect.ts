/**
 * Where a "go back to where you were" parameter is allowed to send the browser (Phase 22 S-34).
 *
 * Without this, `/register?next=https://evil.example` (or `//evil.example`, or `/\evil.example`) turns a
 * trusted link into a phishing redirect right after a successful sign-up. Only a path on THIS site is
 * accepted; anything else falls back.
 */
export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  // Must start with a single slash. "//host" is protocol-relative; "/\host" is read as "//host" by browsers.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // No control characters / line breaks, no embedded scheme tricks.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'http://internal.invalid');
    if (url.origin !== 'http://internal.invalid') return fallback;
  } catch {
    return fallback;
  }
  return value;
}

/**
 * A URL a payment page was told to return to: either a path on this site or an absolute URL on exactly
 * this site's origin. Used by the (development-only) mock checkout page.
 */
export function safeSameOriginUrl(
  value: string | null | undefined,
  origin: string,
): string | null {
  if (!value) return null;
  if (value.startsWith('/')) {
    const path = safeInternalPath(value, '');
    return path || null;
  }
  try {
    const url = new URL(value);
    return url.origin === origin ? url.toString() : null;
  } catch {
    return null;
  }
}
