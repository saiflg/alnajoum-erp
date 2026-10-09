# Phase 22 report — Enterprise security, compliance, disaster recovery and continuity

**LOCALHOST / TEST ONLY.** Nothing was deployed. No production credentials, real provider secrets, real customer messages, payments, tickets or payouts were used. **This report does not claim legal or regulatory compliance** (GDPR, NDPR, PCI-DSS, ISO 27001 or any other regime). It records technical controls and the evidence for them; whether the business complies is a question for a qualified assessor.

Detail lives in [security-baseline.md](security-baseline.md) (the 40-finding register), [security.md](security.md), [disaster-recovery.md](disaster-recovery.md) and [vendor-register.md](vendor-register.md).

## 1. System audit

Three independent read-only audits (authentication/authorisation, tenant isolation and data exposure, financial integrity) plus a dependency audit produced **40 findings** (S-01 … S-40). The auditors only read code, so every finding was re-verified in the code before it was fixed. The most serious were: the mock payment provider as the production default (a customer could mark their own invoice paid), plaintext reset links and temporary passwords stored in notifications and readable across tenants, global integration credentials writable by any company admin, a role-escalation path to Super Admin, a ledger with no tenant, cross-tenant *writes* on a dozen modules, and double-spend / overpayment races.

| Status | Findings |
|---|---|
| FIXED | 26 |
| PARTLY FIXED (remaining work stated per finding) | 13 |
| OPEN / KNOWN-LIMITATION | 1 (S-37 branch isolation) |

## 2. What was built

* **Tenant isolation everywhere.** `resolveTenantFilter`, route-level `@TenantScoped`, a global guard, a per-company ledger (`companyId` on journal entries with backfill), a cross-tenant answer of **404 not 403**. A spec checks every scope against the Prisma schema (it caught a real bug: the campaign scope named a relation that did not exist, so all campaign routes returned 500).
* **Authentication hardening.** argon2id; account status checked per request; refresh rotation with atomic claim and **reuse detection**; sign-out-everywhere; TOTP with replay protection, single-use login challenge, 80-bit single-use recovery codes; lockout on failed second factors; equalised timing for unknown emails.
* **Step-up authentication** (`@RequireStepUp`) on money movement, role changes, payouts, integrations, finance settings, backups, erasure.
* **Field encryption** (AES-256-GCM, versioned keys, context-bound; startup re-encryption = key rotation) for integration credentials, authenticator secrets and staff payout account numbers.
* **Money safety.** Advisory locks, atomic claims, idempotency keys, claim-before-send payouts, atomic refund and approval claims, amount/currency confirmation for real gateways, pending-vs-failed handling so a real payment is not lost.
* **Segregation of duties** on expenses, incentives, manual payments, bank verification, payouts, access reviews and break-glass.
* **Security operations module:** incident register, access reviews, break-glass (Super Admin approval, expiry sweep), privacy export and erasure, retention engine, live control register, console at **Admin → Security & Compliance**.
* **Production guardrails:** the API refuses to boot in production on a mock payment or WhatsApp provider, weak/placeholder/equal JWT secrets, missing encryption key, non-HTTPS origin, dev DB password; no built-in Super Admin password in production.
* **Web:** CSP and security headers, safe redirects, 2FA login step, forgot/reset password pages, CSV formula neutralisation, document magic-byte verification and safe `Content-Disposition`.
* **Operations:** container hardening, encrypted/verified backup script, restore-check script, SBOM generator, vendor register, runbooks.

## 3. Test results (see also the Phase 24 certification)

| Check | Result |
|---|---|
| Cross-tenant replay (656 routes, two tenants, 12 samples per route) | No unexplained exposure; remaining hits are shared platform catalogs (documented) |
| Targeted valid-body cross-tenant mutations | 23 / 23 contained |
| Real parallel races (double credit, overdraft, overpayment, double refund / approval / reversal) | 8 / 8 pass |
| Security operations live suite | 49 / 49 |
| Authentication hardening live suite | 31 / 31 |
| Secret-leak sweep (310 GET routes × 3 users) | No secret-bearing field in any response |
| Backup → restore into a scratch database, row counts compared | Pass (re-run in Phase 24 on 51 migrations incl. AI tables) |
| Production dependency audit | 0 critical; 1 high (`deepmerge-ts` inside Prisma's CLI config loader, build-time) |

## 4. Known limitations (unchanged by this report)

Branch isolation inside one company (S-37); passport numbers are protected by access control, not field-encrypted; no malware scanning or per-customer storage quota; CSP still allows inline scripts; WhatsApp events are attributed to the first company; backups are not scheduled and no off-machine target is configured; the uploads restore and a restore over the live database were not rehearsed; DNS-rebinding SSRF is not defended; registration still answers 409 for an existing email; no email/phone verification; no external penetration test.

**LOCALHOST / TEST ONLY.**
