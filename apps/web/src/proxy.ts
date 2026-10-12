import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy with a per-request nonce (Phase 24, S-34 follow-up).
 *
 * Scripts may run only if they carry this request's random nonce (Next.js adds it to its own scripts when it sees
 * it in the request's CSP header) or were loaded by such a script ('strict-dynamic'). An injected `<script>` or
 * `javascript:` URL, which has no nonce, is refused by the browser. That is what the previous policy
 * (`script-src 'self' 'unsafe-inline'`) could not do.
 *
 * Styles keep 'unsafe-inline': React `style={...}` props and Tailwind-generated inline styles cannot carry a nonce,
 * and style injection is a far smaller risk than script injection. Everything else is unchanged: no framing, no
 * <object>, base URI and form actions pinned to this origin, connections only to this origin and the configured API.
 *
 * In development Next.js also needs 'unsafe-eval' (React refresh) and a websocket.
 */
const isDev = process.env.NODE_ENV !== "production";

const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").origin;
  } catch {
    return "";
  }
})();

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`.trim(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: static assets and the image optimiser need no policy of their own.
      source: "/((?!_next/static|_next/image|favicon.ico|icon.png).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
