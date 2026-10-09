/**
 * What an uploaded file REALLY is, judged by its first bytes rather than by the Content-Type header or the
 * file name the client chose (Phase 22 S-31). Both of those are attacker-controlled: an HTML page or a
 * script uploaded as `passport.png` with `Content-Type: image/png` used to be stored and later served back
 * to staff from the application's own origin.
 */
export type DetectedMime = 'image/jpeg' | 'image/png' | 'application/pdf';

export const EXTENSION_BY_MIME: Record<DetectedMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

/** Bytes needed to decide (the longest signature, the PDF marker, is 5). */
export const SIGNATURE_BYTES = 8;

export function detectMime(head: Buffer): DetectedMime | null {
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    head.length >= 8 &&
    head
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (head.length >= 5 && head.subarray(0, 5).toString('latin1') === '%PDF-') {
    return 'application/pdf';
  }
  return null;
}

/**
 * A Content-Disposition value that survives any file name. The raw name used to be dropped between quotes:
 * a name containing a quote or line break could inject header content, and a non-ASCII name (an Arabic
 * file name is routine here) made Node throw and the download return a 500.
 * ASCII fallback in `filename=`, the real name in RFC 5987 `filename*=`.
 */
export function contentDisposition(
  type: 'inline' | 'attachment',
  filename: string,
): string {
  // Stripping control characters is the point of this expression.
  // eslint-disable-next-line no-control-regex
  const clean = filename.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'file';
  const ascii =
    clean
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\;]/g, '_')
      .slice(0, 150) || 'file';
  const encoded = encodeURIComponent(clean.slice(0, 200)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
