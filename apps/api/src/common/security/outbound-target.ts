import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';
import { isProductionEnv } from './runtime-environment';

/**
 * Admin-configurable outbound targets (an AI provider's baseUrl, an SMTP host) are a server-side
 * request forgery risk: pointing them at the cloud metadata service, the database, or localhost makes
 * the server probe or call internal systems. This rejects the unambiguous cases by their literal
 * form. It does NOT resolve DNS, so a public hostname that resolves to a private address is not
 * caught here — that residual risk is listed in docs/security-baseline.md.
 */

const PRIVATE_V4: Array<[number, number]> = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 carrier NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // 169.254/16 link-local (cloud metadata lives here)
  [0xac100000, 12], // 172.16/12
  [0xc0000000, 24], // 192.0.0/24
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

export function isPrivateAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  const kind = isIP(bare);
  if (kind === 4) {
    const n = v4ToInt(bare);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === base;
    });
  }
  if (kind === 6) {
    if (bare === '::' || bare === '::1') return true;
    if (
      bare.startsWith('fe8') ||
      bare.startsWith('fe9') ||
      bare.startsWith('fea') ||
      bare.startsWith('feb')
    )
      return true; // link-local
    if (bare.startsWith('fc') || bare.startsWith('fd')) return true; // unique local
    const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

const LOCAL_NAMES =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

export function assertSafeHost(
  host: string,
  label: string,
  nodeEnv?: string,
): void {
  const h = host.trim();
  if (!h || /[\s/\\@#?]/.test(h))
    throw new BadRequestException(`${label} is not a valid host name`);
  const production = isProductionEnv(nodeEnv ?? process.env.NODE_ENV);
  if (production && (LOCAL_NAMES.test(h) || isPrivateAddress(h))) {
    throw new BadRequestException(
      `${label} must be a public host (private, loopback and link-local addresses are not allowed)`,
    );
  }
  // The metadata address and link-local space are never legitimate, even in development.
  if (isPrivateAddress(h) && h.replace(/^\[|\]$/g, '').startsWith('169.254.')) {
    throw new BadRequestException(
      `${label} must not point at a link-local/metadata address`,
    );
  }
}

export function assertSafeHttpUrl(
  raw: string,
  label: string,
  nodeEnv?: string,
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException(`${label} is not a valid URL`);
  }
  const production = isProductionEnv(nodeEnv ?? process.env.NODE_ENV);
  if (url.username || url.password)
    throw new BadRequestException(`${label} must not contain credentials`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) {
    throw new BadRequestException(`${label} must use https`);
  }
  assertSafeHost(url.hostname, label, nodeEnv);
}
