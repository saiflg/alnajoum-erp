# Security baseline (Phase 22)

Taken **before** any Phase 22 change, from three independent read-only audits of the repository (authentication/config/secrets; access control/tenancy; documents/payments/webhooks/infrastructure) plus a real `pnpm audit`. Static review only: each item is re-verified when it is fixed, and its status is updated in the **Status** column. Nothing here has been exploited against a live system.

Severity: **P0** breach, tenant escape, financial corruption or data loss · **P1** major control missing · **P2** important, workaround exists · **P3** minor.

## What was already good (not rebuilt)

argon2id for passwords, recovery codes and API keys · reset tokens 256-bit, SHA-256 hashed, 30-minute, single use, all sessions revoked on reset · refresh tokens random, hashed, rotated, cookie-scoped, session list/revoke · httpOnly SameSite cookies, no tokens in localStorage, access JWT carries no permissions (resolved per request) · Helmet, CORS allow-list, global `ValidationPipe` (whitelist + forbidNonWhitelisted) · JWT default-deny with `@Public()` opt-out · every raw SQL is parameterised · no `eval`/`exec` · Paystack and Meta webhooks: raw-body HMAC with constant-time compare, fail closed · atomic PENDING→SUCCEEDED payment claim · unique payment reference · journal rows cannot be edited or deleted via API, reversal is unique per entry · refunds go through the approval engine with self-approval blocked · SUPER_ADMIN grant requires a SUPER_ADMIN · uploads use random UUID names, no static serving · prod compose publishes only 80/443.

## Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| S-01 | P0 | Production defaults to the **mock payment provider**, which always reports success with amount 0, so a customer can mark an invoice paid or credit their own wallet; verification uses the *active* provider, not the intent's | **FIXED** (router refuses mock in production; verify uses the intent's own provider; real providers must confirm exact amount + currency; mock is flagged `simulated`) |
| S-02 | P0 | `Notification.body` stores password-reset links and staff temporary passwords in plaintext; `GET /notifications` is unscoped, so any tenant's admin/finance user can read any user's reset link (account takeover, incl. Super Admin) | OPEN |
| S-03 | P0 | `GET /audit-logs` with no params returns every tenant's audit rows | OPEN |
| S-04 | P0 | `IntegrationCredential` (payment, SMTP, WhatsApp, AI, flight keys) is global, plaintext, and writable by COMPANY_ADMIN: redirect all email, forge payment webhooks (HMAC key is the DB key), SSRF via AI `baseUrl`, activate mock providers for every tenant. Message templates and feature flags, mobile config, finance settings, approval rules are global and tenant-writable too | OPEN |
| S-05 | P0 | Well-known Super Admin (`admin@alnajoum.travel` / `Alnajoum@2026`) is seeded on every production deploy and printed to logs | OPEN |
| S-06 | P0 | `createStaff` accepts any `roleId`, including SUPER_ADMIN (COMPANY_ADMIN → platform takeover); branch not checked against company | OPEN |
| S-07 | P0 | RBAC role assignment/removal is not tenant-scoped (grant/strip roles of any identity in any tenant) | OPEN |
| S-08 | P0 | Wallet admin (list/credit/adjust/transfer) has no tenant binding, no approval, no idempotency | OPEN |
| S-09 | P0 | `GET /manual-payments/:id` returns the customer's whole Identity row (`passwordHash`, `twoFactorSecret`) and is not tenant-bound | OPEN |
| S-10 | P0 | Company and branch controllers unscoped (read/modify/lock out any company; create branches in another company; branch detail returns staff bank numbers) | OPEN |
| S-11 | P0 | The ledger has no `companyId`; chart of accounts, journal entries, trial balance readable and entries reversible by any tenant's finance user; `reverseEntry` is read-then-write | OPEN |
| S-12 | P1 | Cross-tenant **mutations** on flights, hotels, visa, support, CRM leads, customer/family documents (passports), vehicle rentals, corporate, hajj-ops, expenses, payments, incentives/payouts: reads are scoped, writes are not | OPEN |
| S-13 | P1 | Wallet double-spend / negative balance races; overpayment races across staff payment, online intent, wallet and manual approval; payment accepted on a VOID invoice | OPEN |
| S-14 | P1 | A real Paystack payment can be lost: an intent marked FAILED by an early/abandoned verify (or amount/currency mismatch) is never credited when `charge.success` arrives; nothing alerts | **FIXED** (pending/abandoned and amount-mismatch results leave the intent PENDING for later webhook/reconciliation; only a definitive failure is FAILED; mismatch logged for review). Remaining: no alert/dashboard yet |
| S-15 | P1 | `finalizeIntent` / wallet `finalizeDeposit` are not atomic after the claim; ledger posts have no idempotency key; wallet top-ups only verified from the browser (webhook ignores `WDEP-*`) | OPEN |
| S-16 | P1 | Staff payout can be sent twice (cron + click + crash, no claim); refund can execute twice (no open-refund guard, no atomic claim); manual-payment approve race creates two payments | OPEN |
| S-17 | P1 | No segregation of duties: users can approve their own expense, incentive, manual payment, manual flight booking, staff bank verification, wallet credit | OPEN |
| S-18 | P1 | Deactivated/suspended users keep access: `refresh()` and the access strategy never check `identity.status`; deactivation does not revoke refresh tokens | OPEN |
| S-19 | P1 | No `trust proxy`: behind Caddy every client shares one 100/min throttle bucket (one abuser locks everyone out, brute-force limit is ineffective, audit IPs are the proxy's); no per-route throttle on login/register/reset/2FA | OPEN |
| S-20 | P1 | Production config is not validated: no minimum length/placeholder rejection for JWT secrets, mock providers allowed in production, no HTTPS/origin requirements | **PARTLY FIXED** (`checkProductionConfig` at boot: JWT secret length/placeholder/equality, mock payment+WhatsApp refused, origin/https, dev DB password). Still to add: validation of other secrets |
| S-21 | P1 | WhatsApp mock provider's `verifyWebhookSignature` returns true (default): unauthenticated forged inbound messages | OPEN |
| S-22 | P1 | Web: enabling 2FA locks the user out (no 2FA step in login); no forgot/reset password pages although the emailed link points to one | OPEN |
| S-23 | P1 | Backups: same host/volume as the DB, plaintext, unscheduled, unverified, never restore-tested, no restore path; uploads not backed up | OPEN |
| S-24 | P1 | Staff bank account numbers returned by staff list/detail and branch detail endpoints; no encryption at rest anywhere (bank details, integration secrets, TOTP secrets, passport numbers) | OPEN |
| S-25 | P1 | Default install is plain HTTP; Secure cookies then cannot work | OPEN |
| S-26 | P1 | Production dependencies: 4 critical + 13 high advisories (Next.js unauthenticated RCE, proxy-addr, multer, nodemailer, sharp …) | **FIXED** (commit `fbc49f8`): 0 critical, 1 high remaining (Prisma-internal `deepmerge-ts`, build-time only) |
| S-27 | P2 | Tokens also returned in JSON bodies (defeats httpOnly via XSS on public refresh) | OPEN |
| S-28 | P2 | 2FA: secret plaintext, no attempt counter / replay protection, challenge token reusable, recovery codes 40-bit | OPEN |
| S-29 | P2 | Account enumeration (409 on register, timing on unknown email, distinct locked message), lockout abuse, email not normalised, email/phone verification not implemented | OPEN |
| S-30 | P2 | Refresh: no atomic claim, no reuse detection, no logout-all, access cookie lifetime hard-coded | OPEN |
| S-31 | P2 | Documents: no magic-byte validation, extension from client name, unsanitised `Content-Disposition` (Arabic filename → 500), no download/access logging, no quotas; receipts attachable to any id | OPEN |
| S-32 | P2 | CSV exports allow formula injection; exports unaudited/unbounded | OPEN |
| S-33 | P2 | Containers run as root, no healthchecks on api/web, no limits/read-only/cap-drop, unpinned images, app connects as DB superuser, `.dockerignore` misses `apps/api/.env`, Redis unused but deployed with no password | OPEN |
| S-34 | P2 | No security headers on the web app or Caddy (CSP, X-Frame-Options, HSTS, Referrer-Policy); open redirects in `checkout/mock` and `register?next=` | OPEN |
| S-35 | P2 | Unauthenticated flight/hotel search burns paid provider quota; `GET /staff/verify/:code` enumerates staff | OPEN |
| S-36 | P2 | Mass assignment via inline-typed bodies (feedback, campaigns, templates, referrals, tasks, daily-closing, bank-reconciliation) | OPEN |
| S-37 | P2 | Branch isolation absent: every branch filter is caller-supplied | OPEN |
| S-38 | P2 | No customer erasure/anonymisation, retention policy or data-subject export; consent only for WhatsApp | OPEN |
| S-39 | P2 | WhatsApp webhooks: status events dedupe on message id (delivered/read dropped), DB error treated as duplicate, bad signature silent, all events attributed to the oldest company | OPEN |
| S-40 | P3 | Misc: shadowed `/finance/reports/staff-incentive-statement/me`, public packages ignore status, 403-vs-404 existence leak on family docs, lists without `take`, `db:reset:demo` has no environment guard | OPEN |

## Required by the brief but not present at all

Field-level encryption and key management · security event and incident models · security dashboard · compliance control centre · access reviews · data retention engine · break-glass access · step-up authentication · restore/DR runbooks and a tested restore · vendor register · SBOM.

_This register is updated as items are fixed; see the final Phase 22 report for the evidence per item._
