import path from "path";
import type { NextConfig } from "next";

/**
 * Browser-side security headers (Phase 22 S-34). The API sends Helmet's set already; the web app, which
 * serves the actual pages, sent none.
 *
 * The CSP is as strict as Next.js allows without per-request nonces: inline scripts/styles are required
 * by the framework itself (hydration data, styled-jsx), so `'unsafe-inline'` stays for script/style, but
 * everything that matters for clickjacking, injection of foreign resources and form hijacking is locked:
 * no framing, no <object>, base URI and form actions pinned to this origin, connections only to this
 * origin and the configured API. In development Next also needs `'unsafe-eval'` (React refresh).
 */
const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Only meaningful over HTTPS; browsers ignore it on plain HTTP, so it is safe to send everywhere.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // Traces only the dependencies this app actually needs into
  // .next/standalone, so the production Docker image doesn't have to ship
  // the whole pnpm workspace's node_modules. See Dockerfile and
  // DEPLOYMENT.md for how the standalone output is packaged.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
