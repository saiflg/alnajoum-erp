#!/usr/bin/env node
/**
 * Live check of the web app's nonce-based Content-Security-Policy (Phase 24). Needs the web app running as a
 * PRODUCTION build (next build && next start); WEB_BASE overrides http://localhost:3000.
 *
 *   node scripts/certification/csp-check.mjs
 */
const BASE = process.env.WEB_BASE || 'http://localhost:3000';
const results = [];
const check = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n.padEnd(86)} ${String(d).slice(0, 80)}`); };

const get = async (path) => {
  const r = await fetch(BASE + path);
  return { status: r.status, csp: r.headers.get('content-security-policy') ?? '', html: await r.text(), headers: r.headers };
};
const nonceOf = (csp) => /'nonce-([^']+)'/.exec(csp)?.[1];

const a = await get('/login');
const b = await get('/login');
check('the page is served', a.status === 200, a.status);
check('a Content-Security-Policy header is present', a.csp.length > 0);
const script = /script-src([^;]*)/.exec(a.csp)?.[1] ?? '';
check("script-src no longer allows 'unsafe-inline'", !script.includes("'unsafe-inline'"), script.trim());
check("script-src requires this request's nonce and uses strict-dynamic", /'nonce-/.test(script) && script.includes("'strict-dynamic'"));
check('there is no unsafe-eval in production', !script.includes("'unsafe-eval'"));
check('framing, objects, base-uri and form targets stay locked', ['frame-ancestors \'none\'', "object-src 'none'", "base-uri 'self'", "form-action 'self'"].every((d) => a.csp.includes(d)));
check('the nonce is different on every request', nonceOf(a.csp) && nonceOf(a.csp) !== nonceOf(b.csp), `${nonceOf(a.csp)?.slice(0, 10)}… vs ${nonceOf(b.csp)?.slice(0, 10)}…`);

const tags = [...a.html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
const withNonce = tags.filter((t) => t.includes(`nonce="${nonceOf(a.csp)}"`));
check('every <script> in the page carries the nonce', tags.length > 0 && withNonce.length === tags.length, `${withNonce.length}/${tags.length}`);
check('no inline event handlers or javascript: URLs in the markup', !/\son\w+="/i.test(a.html) && !/href="javascript:/i.test(a.html));

// the other security headers are still sent
for (const h of ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security', 'cross-origin-opener-policy', 'permissions-policy'])
  check(`header ${h} still present`, a.headers.get(h) !== null);

// several different pages, including ones that used to be prerendered
for (const path of ['/', '/about', '/register', '/forgot-password', '/portal/dashboard', '/admin/ai']) {
  const p = await get(path);
  const n = nonceOf(p.csp);
  const ts = [...p.html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  check(`${path}: served with a nonce and all scripts nonced`, p.status < 500 && !!n && ts.every((t) => t.includes(`nonce="${n}"`)), `${p.status}, ${ts.length} scripts`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} FAILED`);
process.exit(failed ? 1 : 0);
