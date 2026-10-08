# Security guide (Phase 22)

What the platform enforces, how to operate it, and what it does **not** do. This describes the software. It is **not a compliance certification**: nothing here states that Alnajoum meets GDPR, NDPR, PCI-DSS, ISO 27001 or any other regime. Whether the business complies is a legal and organisational question that needs a qualified assessor; this document records the technical controls and the evidence for them.

The findings that drove this phase, and their current status, are in [security-baseline.md](security-baseline.md). Disaster recovery is in [disaster-recovery.md](disaster-recovery.md). Third parties are in [vendor-register.md](vendor-register.md). The dependency inventory is [sbom.cdx.json](sbom.cdx.json) (regenerate with `node scripts/sbom.mjs`).

## 1. Controls and where they live

| Area | Control | Code |
|---|---|---|
| Tenant isolation | Every company is a tenant. Reads and writes are scoped by `resolveTenantFilter`; a record in another company answers **404**, never 403. Route-level `@TenantScoped(...)` + a global guard cover id-addressed records; a spec validates every scope against the Prisma schema | `common/tenancy/*` |
| Authentication | argon2id passwords; per-request account status and role resolution; five failures (password **or** second factor) lock the account for 15 minutes; deactivation revokes sessions; equal-cost path for unknown emails | `modules/auth/*` |
| Sessions | httpOnly cookies, refresh rotation with an atomic claim, **reuse detection** (a rotated token replayed after 30 s revokes the whole login), sign out everywhere (`POST /auth/sessions/revoke-all`), cookie lifetime follows `JWT_*_EXPIRES_IN` | `auth.service.ts`, `auth.controller.ts` |
| Two-factor | TOTP; authenticator secret **encrypted at rest**; each code usable once (replay protection); login challenge single-use; recovery codes 80-bit, argon2-hashed, atomic single use | `two-factor.service.ts` |
| Step-up | Money movement, role changes, payouts, integrations, finance settings, backups, privacy erasure and access-review completion need a fresh proof of identity (password, or authenticator code) valid for 5 minutes | `common/security/step-up.ts` |
| Segregation of duties | You cannot approve your own expense, incentive, manual payment, bank verification, payout, access review or break-glass request | per service |
| Money safety | Advisory locks, atomic status claims, idempotency keys, claim-before-send payouts | `common/db/payment-guards.ts` |
| Secrets | AES-256-GCM `FieldCipher` with versioned keys, context-bound ciphertext. Encrypted: integration credentials, authenticator secrets, staff payout account numbers | `common/security/field-cipher.ts` |
| Config safety | The API refuses to start in production with mock payment/WhatsApp providers, weak or placeholder secrets, missing encryption key, non-HTTPS origin | `common/security/runtime-environment.ts` |
| Uploads | Magic-byte verification, safe filenames and `Content-Disposition`, staff downloads audited | `common/documents/*` |
| Input | Global `ValidationPipe` (whitelist, forbid unknown); every request body is a class (no inline types) | all controllers |
| Rate limits | Credentials 10/min, public search 20/min, badge lookup 20/min, contact form 5/min, global 100/min; real client IP behind the proxy via `TRUST_PROXY_HOPS` | `common/security/throttle-limits.ts` |
| Web | CSP and security headers, safe redirects, no tokens in JavaScript-readable storage, mock checkout disabled in production | `apps/web/next.config.ts` |
| Operations | Container hardening (non-root, read-only, healthchecks), verified encrypted backups, restore check | `docker-compose.prod.yml`, `deploy/*` |
| Monitoring | Security events on the audit log, incident register, access reviews, break-glass, privacy requests, retention, live control register | `modules/security/*`, UI at **Admin → Security & Compliance** |

## 2. The Security & Compliance console

`/admin/security` (Company Admin and Super Admin; other staff only see *Emergency access*):

* **Overview & controls** – failed sign-ins, lockouts, role changes, blocked escalations, reset requests, API keys, privileged accounts without two-factor, accounts unused for 90 days, and a control register measured from the running system. A control that cannot be measured from inside the application is shown as **UNKNOWN**, never as a pass.
* **Incidents** – open, investigate, contain, resolve, close; every change is a timeline note. An incident flagged "personal data involved" prompts the breach-notification steps in §5.
* **Access review** – a snapshot of every staff account with roles, 2FA state and last sign-in; the reviewer marks KEEP or REVOKE for each; completing the review deactivates and signs out the REVOKE accounts. Nobody reviews their own access.
* **Break-glass** – time-boxed (5–120 min) emergency role, approved by a Super Admin with step-up, removed automatically by a sweep, revocable early. `SUPER_ADMIN` can never be granted this way.
* **Privacy requests** – customer data export (JSON) and erasure. Erasure anonymises personal details, removes stored documents and sign-in, and **keeps** invoices, payments and ledger entries (legal record-keeping) with the person replaced by a placeholder. Blockers (open bookings, unpaid balances) are listed first.
* **Retention** (Super Admin) – removes expired refresh/reset tokens, old notifications and processed webhook events. It never touches the audit log or financial records.

## 3. Operating procedures

### 3.1 First deployment checklist
1. Generate secrets: two different `JWT_*_SECRET` (≥ 32 chars), `DATA_ENCRYPTION_KEYS` (`id:base64(32 bytes)`, e.g. `openssl rand -base64 32`), a strong `POSTGRES_PASSWORD`.
2. Set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters, not a known default) *before the first seed*; change it on first sign-in and turn on two-factor.
3. Set `PUBLIC_WEB_ORIGIN`/`CORS_ORIGIN` to the real https origin and `TRUST_PROXY_HOPS` to the number of proxies in front of the API.
4. **Back up `DATA_ENCRYPTION_KEYS` somewhere that is not the server.** Without it every encrypted column is unrecoverable, including from a perfect database backup.
5. Start the API and read the startup log: the production check lists anything it refused or warns about.

### 3.2 Incident response
1. **Detect** – Admin → Security overview (spikes in failed sign-ins, lockouts, blocked escalations, `security.refresh_token_reuse`), user reports, provider alerts.
2. **Record** – open an incident (severity, whether personal data is involved). Everything you do from here goes in the timeline.
3. **Contain** – deactivate the account (Staff), *Sign out everywhere* for an identity, revoke API keys, rotate the affected credential (§3.3), disable the integration, switch the feature flag off.
4. **Investigate** – the audit log is append-only through the application; filter by identity, entity, action and time. Do not edit data to "tidy up".
5. **Recover** – restore from backup only if data was damaged (see [disaster-recovery.md](disaster-recovery.md)); otherwise fix forward.
6. **Notify** – §5.
7. **Close** – write what happened, root cause and the change made; move the incident to RESOLVED, then CLOSED.

### 3.3 Key and secret rotation
* **Data-encryption key** – (a) generate a new key; (b) set `DATA_ENCRYPTION_KEYS="old:<k1>,new:<k2>"` and `DATA_ENCRYPTION_KEY_ID=new`; (c) restart the API. At startup, integration credentials, authenticator secrets and staff payout account numbers still under the old key are re-encrypted under the new one (logged). (d) Verify nothing references the old id: `SELECT count(*) FROM identities WHERE "twoFactorSecret" LIKE 'enc:v1:old:%'` (and the same for `staff."bankAccountNumber"` and `integration_credentials.config::text`). (e) Only then remove `old`. Old backups still need the old key to be readable: keep it with that backup's retention.
* **JWT secrets** – changing them signs everyone out (acceptable, and the right response to a suspected leak). Change both, restart.
* **Provider keys (Paystack, WhatsApp, SMTP, AI)** – rotate at the provider first, then update under Admin → Integrations (Super Admin, step-up). The old value is overwritten and was never shown again.
* **Database password** – change in Postgres, update `DATABASE_URL`/`POSTGRES_PASSWORD`, restart.
* **Backup passphrase** – re-encrypt or re-take backups under the new passphrase; keep the old one for as long as old encrypted backups are retained.

### 3.4 Staff on- and off-boarding
* **Joining** – create the account with the least-privileged role that works; the role-grant ceiling stops you granting more than you hold. Require two-factor for anyone with finance, admin or approval roles.
* **Leaving** – the same day: deactivate the account (this revokes sessions), reassign their leads/tasks, revoke any API keys they created, remove break-glass grants, run an access review if more than one person left.
* **Role change** – change the role, then confirm the old one is gone (Roles → user). Quarterly: complete an access review.

### 3.5 Customer privacy requests
Use Admin → Security → Privacy requests. Verify the requester's identity *outside* the system first. Export, then (if requested and allowed) erase. Both are recorded. The legal time limit for answering a request is yours to know and track; the platform does not enforce it.

## 4. What the platform does not do (known limitations)

* **No compliance certification.** No external audit or penetration test has been performed.
* **Branch-level isolation** – tenant (company) isolation is enforced; inside one company, branch filters are chosen by the caller (S-37).
* **Database role** – the application still connects as a database superuser; least-privilege roles and row-level security are not implemented.
* **Network-level SSRF** – outbound integration URLs are checked for private/loopback literals, but DNS-based rebinding is not defended.
* **Email/phone verification** is not implemented; registration reveals whether an email exists (it is rate-limited).
* **WhatsApp** inbound messages are attributed to a single company (single-tenant assumption).
* **Passport numbers and other customer identifiers** are protected by access control and tenant isolation but are **not** field-encrypted.
* **No malware scanning** of uploads (type is verified by content, but files are not scanned).
* **No SIEM / alert delivery** – security events are on the dashboard and audit log; nothing pages anyone.
* **Container and deployment hardening** is written but has not been built or run in this environment.

## 5. Breach notification

If personal data may have been accessed, disclosed, lost or altered without authority:

1. Open an incident with *personal data involved* ticked, and record when you became aware (the clock for regulators usually starts then).
2. Establish what data, whose, how many people, and whether it was encrypted or otherwise unintelligible (the audit log and the data export tell you what each record held).
3. **Take legal advice** on whether and when to notify the data-protection regulator and the affected people. Many regimes set a short deadline (for example 72 hours for GDPR; NDPR and other regimes differ). The platform cannot tell you which law applies to you.
4. Notify affected customers clearly: what happened, what data, what you have done, what they should do, who to contact.
5. Record every decision and notification in the incident timeline.

## 6. Verification evidence

| Script (local, throw-away data) | Checks |
|---|---|
| `apps/api/scripts/security/cross-tenant-attack.mjs`, `targeted-tenant-checks.mjs` | Cross-company reads and writes across 576 routes, plus valid-body attacks |
| `apps/api/scripts/security/concurrency-check.mjs` | Real parallel races: double credit, overdraft, overpayment, double refund, double approval |
| `apps/api/scripts/security/security-ops-check.mjs` | Step-up, incidents, access review, break-glass, privacy, retention |
| `apps/api/scripts/security/auth-hardening-check.mjs` | 2FA encryption/replay/lockout, refresh reuse detection, bank encryption, throttles, validation |
| `deploy/backup.sh` + `deploy/restore-check.sh` | Encrypted backup restored into a scratch database and compared |

Results at the time of writing are in the Phase 22 report.
