# Phase 24 — Final QA, performance, security and production-certification gate

**LOCALHOST / TEST ONLY.** Nothing was deployed. No production credentials, real provider secrets, real customer messages, payments, tickets or payouts were used. Every external provider (payments, WhatsApp, email, flights, AI) was the built-in mock. This document reports what was run, what passed, what failed and was fixed, and what was **not** tested. It does not claim legal or regulatory compliance of any kind.

## Verdict

# CONDITIONALLY READY

The software is in good shape for a **staging deployment with sandbox providers**: every automated, live, concurrency, security, recovery and container check that could be run on one developer machine now passes, and the defects this phase found were fixed and re-proved. It is **not** certified for production, because the things that decide production safety were not and could not be tested here: real provider behaviour, a production-sized host, an independent penetration test, the full TLS/proxy stack, and a legal review. The conditions are listed in section 7. "Production ready" is not claimed.

## 1. Environment and its limits

Windows 11, 4 GB RAM (about 300 MB free during heavy steps), Docker Desktop VM of about 1.8 GB, Node 24 on the host and Node 22.22 in the images, PostgreSQL 16.4 in a container, one machine running the API, database, load generator and browser together. Mock providers throughout. Consequences: latency and throughput figures below are **developer-laptop figures, not capacity statements**; the memory pressure also made Docker builds slow (API image 75 min, web image about an hour) and made database connections drop intermittently until the load was reduced.

## 2. Evidence matrix

| Area | Check | Result |
|---|---|---|
| Static | TypeScript, API | **PASS** |
| Static | TypeScript, web | **PASS** |
| Static | Lint, API (`eslint src test`) | **PASS** — 0 errors (was 184 in older files; 172 auto-fixed, 12 fixed by hand), 23 warnings (typed-`any` from supertest in spec files) |
| Static | Lint, web | **PASS** — 0 errors, 5 warnings (`react-hooks/exhaustive-deps`, one relative-redirect hint) |
| Static | `prisma validate` | **PASS** |
| Unit | API, all modules | **PASS** — 180 / 180 suites, **2,126 / 2,126** tests |
| Unit | Web | **KNOWN-LIMITATION** — the web app has no unit tests; it is covered by lint, typecheck, build and the browser walk-through below |
| Integration / E2E | `test/*.e2e-spec.ts` (auth + RBAC, customers, family, flights, payments, gateway, notifications, contact, app) | **PASS** — 9 / 9 suites, **122 / 122** tests (they could not start at all before this phase, see section 4) |
| Migrations | All 51 applied from an empty database | **PASS** — 37–63 s; `migrate status` up to date; `migrate diff` against the schema is empty (no drift) |
| Seeds | Base seed, run twice (idempotent); demo seed on a fresh database | **PASS** (after a fix, section 4) |
| Builds | API `nest build`; web `next build` (also inside Docker) | **PASS** |
| Docker | API image and web image built from the repository Dockerfiles | **PASS** (after three Dockerfile fixes) — API 1.79 GB, web 483 MB |
| Docker | API container with the production hardening flags (uid 1000, read-only root, all capabilities dropped, 1 GB cap): healthy, database connected, volumes writable, code read-only, `pg_dump` 16 present, login, authenticated read, 401 when unauthenticated, genuine image upload accepted, HTML-as-image rejected | **PASS** 10 / 10 |
| Docker | Production-mode boot with the mock payment provider | **PASS** — the container **refuses to start** (exit 1: "Unsafe … provider is forbidden in production") |
| Docker | Web container with hardening flags: serves pages, uid 1000, read-only root, CSP / X-Frame-Options / nosniff / Referrer-Policy present | **PASS** |
| Docker | Full `docker-compose.prod.yml` stack incl. Caddy and TLS | **NOT TESTED** — needs production secrets and a domain (condition C5) |
| Health | `/api/v1/health` on the host process and in the container; Docker healthcheck | **PASS** for the API (Docker reported `healthy`); for the web container the pages were served and the healthcheck still read `starting` when last looked at, before the container was stopped, so its healthy state was **not observed** |
| Browser E2E | Containerised web → containerised API: customer login, dashboard, invoices, wallet, AI assistant ("How much do I owe?" answered from the ledger with sources); company admin login, AI Control Center, Security & Compliance, Executive analytics | **PASS** — all pages rendered live data; the only console errors are the expected 401 session probe before login |
| WhatsApp mock | Simulated inbound goes through the real pipeline, recorded once, public webhook answers, simulator needs staff auth (customer 403) | **PASS** 5 / 5 |
| AI | Live suite (customer answers from ledger incl. Hausa/Arabic, booking once under concurrency, payment link idempotent, approvals incl. self-approval and cross-tenant, red-team attacks, tenant isolation, hand-off, kill switch, budgets, provider failure, dry-run, versions, scans, memory, audit) | **PASS** **106 / 106** — on the development database **and** on a database built from scratch |
| AI | Load and duplicate prevention | **PASS** 9 / 9 |
| Security | Authentication hardening (2FA replay, lockout, refresh reuse, validation) | **PASS** 31 / 31 |
| Security | Security operations (incidents, access reviews, break-glass, privacy, retention, step-up) | **PASS** 49 / 49 |
| Security | Secret-leak sweep (310 GET routes × 3 users, 1,021 requests) | **PASS** — no secret-bearing field in any response |
| Security | Cross-tenant replay, 656 routes, two tenants | **PASS with documented hits** — only shared platform catalogs (hotel catalog, Hajj/Umrah packages, visa rules / services / incentive policies, tax rules, package profitability metadata) and platform-level agent definitions are readable by both tenants; the profitability report counts only the caller's own registrations |
| Security | Targeted valid-body cross-tenant mutations | **PASS** 23 / 23 (2 skipped: no victim record in the data) |
| Security | Real parallel races: double credit, overdraft, overpayment, double refund / approval / reversal | **PASS** 8 / 8 |
| Security | Production dependency audit | **PASS with note** — 0 critical, 1 high (`deepmerge-ts` in Prisma's CLI config loader, build-time only, not on the request path) |
| Money | Single checkout per invoice; late checkout after cash settlement; confirm-twice | **PASS** 18 / 18 (after the fix in section 4) |
| Money | Financial reconciliation (21 invariants: balanced ledger per currency, reversals mirror originals, invoice status ↔ payments, no over-payment, intents ↔ payments ↔ surplus credits, wallet balances / transfers / references) | **PASS** 21 / 21 on the database built from scratch after the whole regression run. **On the development database: 19 / 21**, the two failures being three historical over-paid invoices created by the old code before the fix (kept as evidence) |
| Recovery | Encrypted backup → checksum → wrong passphrase refused → restore into a new database → application boots on it → sign-in and reads work | **PASS** — restore 55 s, 100 s end to end on the demo-sized database; 51 migrations present |
| Recovery | Uploads archive → restore into an empty volume | **PASS** — 5 files, identical checksums |
| Recovery | Full rebuild on a new server; restore over the live database | **NOT TESTED** (condition C4) |
| Performance | HTTP load (section 5) | **PASS with one stated limit** |

## 3. How to reproduce

```bash
# static + unit + e2e (apps/api)
npx tsc --noEmit -p tsconfig.json && npx eslint "{src,test}/**/*.ts" && npx jest
npx jest --config ./test/jest-e2e.json --runInBand
# clean-room database (never the development one): migrate, seed, demo seed, then start the API on it
npx prisma migrate deploy && npx prisma db seed && npm run db:seed:demo
DB_NAME=alnajoum_cert node scripts/ai/ai-agents-check.mjs          # AI live, 106 checks
DB_NAME=alnajoum_cert node scripts/ai/ai-perf-check.mjs
DB_NAME=alnajoum_cert node scripts/security/security-ops-check.mjs
DB_NAME=alnajoum_cert node scripts/security/auth-hardening-check.mjs
DB_NAME=alnajoum_cert node scripts/security/secret-leak-sweep.mjs
DB_NAME=alnajoum_cert node scripts/security/concurrency-check.mjs
DB_NAME=alnajoum_cert node scripts/certification/checkout-race-check.mjs
node scripts/certification/load-check.mjs --seconds 15 --users 20
docker exec -i alnajoum-postgres psql -U alnajoum -d alnajoum_cert -At -f - < scripts/certification/financial-reconciliation.sql
powershell -File scripts/security/run-attack.ps1 -Out <dir> -NoBuild     # replay + targeted + concurrency
# images
docker build -f apps/api/Dockerfile -t alnajoum-api:cert .
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=<api origin> -t alnajoum-web:cert .
```

Start the API with `GLOBAL_THROTTLE_LIMIT`, `AUTH_THROTTLE_LIMIT` raised and `WORKFLOW_SCHEDULER_DISABLED=true` for the live scripts (otherwise the rate limiter, correctly, answers 429).

## 4. Defects found by this phase, and fixed

| # | Found by | Defect | Fix and proof |
|---|---|---|---|
| 1 | Financial reconciliation | **Customers could pay an invoice twice.** Two concurrent checkouts, or an abandoned checkout that completed after cash settled the invoice, each recorded a full payment. Three invoices in the dev database ended up paid 2–3 times and the customer portal showed a negative "balance due". | One live checkout per invoice, created under the invoice lock (second attempt → 409); a checkout landing on a settled / void invoice applies only what is owed and credits the surplus to the customer's wallet with its own ledger entry, atomically. 18 / 18 live checks, 4 new unit tests, reconciliation clean on a fresh database. Baseline entry **S-41**. |
| 2 | Running the e2e suite | **All nine e2e suites could not start** (`@nestjs/schedule` is ESM and the e2e config could not load it), so none had run for a long time; once running, 15 tests were out of date with deliberate later changes (tenant isolation → staff must belong to the customers' company; verified uploads → fake bytes are rejected; the role matrix grants branch managers and staff flight booking; flight search is public with its own rate limit). | Config fixed; tests updated to assert the current, intended behaviour and, where the old intent was lost (a role without `flight:book`), re-pointed at a role that really lacks it. 122 / 122. |
| 3 | Full unit run | A rejected upload could leave an empty file behind under load. | File removed only after its stream closes. **S-43**. |
| 4 | Docker build | **The images could not be built.** Corepack in the pinned Node image failed with "Cannot find matching keyid"; pnpm 11 needs Node 22.13+; the install failed on a slow registry link. | pnpm installed from npm at the pinned version, Node 22.22.0, longer timeouts and retries, metadata cache. Both images built and run. **S-42**. |
| 5 | Migration certification | **The demo seed failed on a fresh database** (support categories and lead stages were only created when the API first booted). | The seed creates the rows it depends on. |
| 6 | Lint | 184 lint errors across older files. | 0 errors. |
| 7 | Perf script | The AI perf test assumed no open checkout, which the new rule correctly refuses. | Test set-up closes stale pending checkouts. |

## 5. Performance (developer laptop, mock providers, 20 virtual users × 15 s per scenario, database built from scratch)

| Scenario | Requests | req/s | Errors | p50 ms | p95 ms | p99 ms | Budget p95 | Result |
|---|---|---|---|---|---|---|---|---|
| health | 27,347 | 1,823 | 0 | 8 | 25 | 43 | 300 | PASS |
| admin: invoice list (unpaginated, 83 rows) | 412 | 27 | 0 | 655 | 1,414 | 1,666 | 1,500 | PASS (at the limit) |
| admin: customer list | 921 | 61 | 0 | 277 | 424 | 2,100 | 1,500 | PASS |
| admin: dashboard KPIs | 720 | 48 | 0 | 396 | 629 | 2,588 | 2,500 | PASS |
| admin: executive analytics overview — 20 users | 99 | 7 | 0 | 654 | **12,879** | 12,905 | 3,000 | **FAIL at 20 concurrent** |
| … same, 10 users | 229 | 15 | 0 | 430 | 2,077 | 4,258 | 3,000 | PASS |
| … same, 5 users | 355 | 24 | 0 | 177 | 305 | 1,739 | 3,000 | PASS |
| finance: journal entries | 1,361 | 91 | 0 | 218 | 279 | 304 | 2,000 | PASS |
| customer: own invoices | 1,563 | 104 | 0 | 186 | 242 | 284 | 1,500 | PASS |
| customer: own wallet | 1,629 | 109 | 0 | 178 | 238 | 283 | 1,500 | PASS |
| public flight search | 20 answered | — | 0 | 256 | 330 | 330 | 2,500 | PASS — 25,770 further requests were refused **429 by design** (20 / min / client protects paid provider quota) |
| AI assistant (balance question) | 422 | 28 | 0 | 692 | 849 | 1,194 | 4,000 | PASS |

There were no 5xx responses in any scenario. Reading the table honestly: the executive overview computes live from transactional tables on every request (a Phase 20 design decision), so it saturates at roughly 15 requests per second here and queues behind the database connection pool beyond about 10 simultaneous users; the admin invoice list returns every row with no pagination and will degrade as data grows. Neither is a correctness problem, both are scaling limits that a production-sized host and data volume must be measured against (condition C3).

## 6. Not tested or known limitations (carried into the verdict)

* **No real provider was ever called.** Paystack, OPay, Meta WhatsApp, Duffel, SMTP and every AI model were mocks. Signature verification, amount confirmation, webhook retries and error shapes are unit-tested against documented formats, not against the live services. The mock AI provider is a rule-based planner, not a language model.
* No external penetration test or security audit. The three audits behind the baseline were internal code reviews.
* Branch isolation inside a company is not enforced (S-37) — a product decision.
* Passport numbers and other customer identifiers are protected by access control, not field-encrypted; no malware scanning or storage quotas on uploads.
* The CSP still allows inline scripts / styles; DNS-rebinding SSRF is not defended; registration still answers 409 for an existing email; no email / phone verification.
* WhatsApp events are all attributed to the platform's first company.
* Backups are not scheduled and no off-machine copy is configured; a full server rebuild and a restore over the live database were not rehearsed.
* No SIEM or alert delivery; no live-data monitoring beyond the in-app console.
* List endpoints without a row cap (S-40); live-aggregated analytics (section 5).
* There is no Finance queue for wallet credits created from surplus payments (they are ordinary wallet transactions named `SURPLUS-<reference>`), and the admin landing page still shows placeholder text from Phase 1.
* The single "high" dependency advisory, and the dev-only tooling advisories, remain; advisories appear continuously and `pnpm audit --prod` must be re-run on every update.

## 7. Conditions that stand between this verdict and "certified for staging / production preparation" and production

**Needed before a staging deployment**

* **C1.** Replace every mock with a vendor *sandbox* (Paystack / OPay test keys, Meta test number, Duffel test token, SMTP, and a real model if the AI layer is to be enabled) and re-run the AI, money and security suites against them, including webhook signature and amount-mismatch paths.
* **C2.** Generate real secrets (`JWT_*`, `DATA_ENCRYPTION_KEYS`, bootstrap admin password), put the keys in custody **outside** the server, and set `PUBLIC_ORIGIN` / `TRUST_PROXY_HOPS`.
* **C3.** Run the load script and a larger data volume on a production-like host; add pagination to the unbounded list endpoints and a short-lived cache (or a connection-pool increase) for the executive overview.
* **C4.** Schedule `deploy/backup.sh`, configure an off-machine copy, and rehearse a full rebuild and a restore over a staging database.
* **C5.** Bring up the real `docker-compose.prod.yml` stack (Caddy, TLS, real domain) and run the live suites against it.

**Needed before production**

* **C6.** An independent penetration test and fixes for its findings.
* **C7.** A decision on branch isolation (S-37), field-level encryption of passport numbers, and removal of inline scripts from the CSP.
* **C8.** Alerting / on-call: security events and payment mismatches must reach a person.
* **C9.** A legal and compliance review by a qualified assessor (data protection, payments, travel regulation). Nothing here is a compliance claim.

## 8. Statement

The system was inspected and tested as described above; the results are reproducible with the commands in section 3. Defects were found, fixed and re-proved rather than reported and left. The final status is:

**CONDITIONALLY READY**

**LOCALHOST / TEST ONLY.**
