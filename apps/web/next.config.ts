import path from "path";
import type { NextConfig } from "next";

/**
 * Browser-side security headers (Phase 22 S-34). The API sends Helmet's set already; the web app, which
 * serves the actual pages, sent none.
 *
 * The Content-Security-Policy is NOT here: it needs a fresh nonce on every request, so it is built in
 * src/proxy.ts. The headers below do not vary per request.
 */
const securityHeaders = [
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
