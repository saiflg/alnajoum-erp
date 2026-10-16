# Phase 27 - Integration, end-to-end testing and operational readiness

Date: 2026-10-16. Scope: localhost and the dedicated test database only. **Nothing was deployed, pushed, or sent to a real
provider, customer, bank or airline.** All providers used are the built-in mocks.

Status labels: **VERIFIED** (run in this phase, result recorded), **PARTIALLY VERIFIED**, **MOCKED** (passes against a labelled
test double), **BLOCKED** (cannot be tested without hardware, an account or a decision), **NOT IMPLEMENTED**.

## 1. Baseline and method

* Git: branch `master`, last commit before this phase's changes `3ef34a0`. Working tree changes are listed in section 5. No
  destructive git command, no database reset, drop or wipe was run. The development database was only read (reconciliation SQL).
* The test database `alnajoum_erp_test` is separate; it is migrated with `migrate deploy` and seeded with upserts only.
* Every number below comes from a command run in this phase. Raw outputs were kept outside the repository.

## 2. Results (actual)

| Check | Result | Status |
|---|---|---|
| API unit tests (`npx jest`) | **192 suites, 2432 tests, all passed** (final run) | VERIFIED |
| API e2e (`jest --config ./test/jest-e2e.json`) | **10 suites, 155 tests, all passed** (122 pre-existing + 33 new workflow tests) | VERIFIED |
| New workflow suite run twice in a row | 33/33 both times (repeatable, unique data per run) | VERIFIED |
| API typecheck (`tsc --noEmit`) | 0 errors | VERIFIED |
| Web typecheck (`tsc --noEmit`) | 0 errors | VERIFIED |
| Web lint | 0 errors, 5 warnings (pre-existing: `window.location.href` etc.) | VERIFIED |
| API lint | 0 errors on the files changed in this phase; the whole-project run earlier had 0 errors, 23 warnings (all `no-unsafe-*` in older e2e specs) | VERIFIED |
| Web production build | succeeds | VERIFIED |
| Live certification: staff cards (QR) | 73/73 | VERIFIED (against local API) |
| Live certification: NFC cards | 61/61 with the **mock** reader | MOCKED |
| Live certification: contacts and consent | 118/118 | VERIFIED |
| Live certification: campaigns, delivery, inbound opt-out | 96/96 with **simulated** providers | MOCKED |
| Financial reconciliation SQL (read-only), test DB after the workflow tests | 0 violations | VERIFIED |
| Financial reconciliation SQL, development DB | 2 invariants, 3 historic invoices over-paid (see P1-2) | VERIFIED (defect found, not fixed) |
| Docker Compose configuration validation | passed in the baseline | VERIFIED |

Honest notes on the runs:

* The first complete e2e run after the new suite was added showed 29 failures in 4 old suites with
  `Can't reach database server at localhost:5432`. Docker Desktop had stopped (this machine runs short of memory while the unit
  tests and Docker compete). After Docker was restarted the same suite passed 155/155. This is an environment problem, not a code
  defect, but it means the local database container is not reliable on this machine under load.
* In the earlier baseline, one unit suite (`common/documents/image-quality.util.spec.ts`, 2 tests) failed once under heavy load;
  in the final run it passed. Treat it as timing-sensitive until it is investigated (P3).

## 3. End-to-end scenarios

The new suite is `apps/api/test/workflows.e2e-spec.ts` (HTTP level, real database, mock providers, invented `example.com` people).

| # | Scenario | Evidence | Status |
|---|---|---|---|
| 1 | Staff identity: create staff, issue card (QR, NFC), verify valid/suspended/revoked/replaced, public lookup, privacy | `staff-cards-check.mjs` 73/73, `nfc-cards-check.mjs` 61/61, unit tests | VERIFIED (QR); MOCKED (NFC) |
| 2 | Customer flight booking: ticket refused while unpaid, instalment, balance, PAID, ticket issued once, one ledger entry per payment, receipts sent | workflow suite | VERIFIED |
| 3 | Visa: service published, application lodged by staff, invoice raised, completion refused while unpaid (**defect found and fixed**), completion after payment creates exactly one incentive, completion is final, customer cannot complete | workflow suite + unit tests | VERIFIED |
| 4 | Hajj instalments: three payments, PARTIALLY_PAID to PAID, ledger entry each, over-payment and payment on a settled invoice refused, nothing recorded on a rejected payment | workflow suite | VERIFIED |
| 5 | Staff incentive: created at ticketing, approval needs permission, step-up for payout, no bank details refused, unverified account refused, account holder cannot verify own account, provider rejection (`0000000000`) leaves incentive APPROVED and posts nothing, corrected account must be re-verified, retry pays **once**, repeat attempts refused, one payout row, at most one ledger posting | workflow suite | VERIFIED (mock payout provider; no real money) |
| 6 | Communication consent: double opt-in, send-time consent check, STOP in English/Hausa/Arabic, hard suppression, campaign approval, rate limit | `comm-contacts-check.mjs` 118/118, `comm-campaigns-check.mjs` 96/96 | MOCKED (simulated providers) |
| 7 | Tenant and role security: unauthenticated refused, customer cannot reach staff endpoints, staff cannot record payments, customer cannot ticket, other customer cannot read or pay an invoice, step-up required and bound to the person | workflow suite + tenant-scope registry test + live scripts (cross-company 404s) | VERIFIED |
| 8 | Error recovery: **two simultaneous full payments record exactly one**, hostile/malformed payment bodies refused with nothing recorded, double cancel refused, repeated payout refused, payout failure recoverable. Webhook retry and duplicate checkout verification are covered by the existing `payment-gateway.e2e-spec.ts` (idempotent verify, signed webhook, bad signature rejected) | workflow suite + existing suite | VERIFIED |

Not covered by an automated end-to-end test (see section 7): real provider timeouts (the mock providers do not time out on
demand; unit tests cover the failure branches), notification-provider failure at the HTTP level (unit tests only), and browser
UI journeys.

## 4. Audit findings

### Fixed in this phase

* **P1-1 - An unpaid visa application could be marked COMPLETED** by any staff member who can manage applications. Completion
  recognises the supplier cost in the ledger and credits the agent's incentive, so staff could generate an incentive for a service
  nobody paid for (a Finance approval still stood between that and money, but the cost posting and the pending incentive were
  already created). `VisaService.updateStatus` now refuses COMPLETED unless the invoice is PAID (applications with no invoice,
  i.e. recorded offline, are not blocked). Two unit tests and the e2e scenario cover it. The provider-status sync goes through the
  same method, so it is also refused for an unpaid application.
* **P2-1 - A fresh install had Visa, Hajj, Umrah, Hotels, Group bookings and Corporate travel switched off.** Feature flags fail
  closed and the seed created none, so every guarded module answered 403 until someone created the flags by hand (the development
  database only worked because the rows were created earlier). `prisma db seed` now creates the six `ENABLE_*` module flags
  (on) and `ENABLE_AUTOMATIC_PAYOUT` (off), only when missing, never overwriting an administrator's choice.

### Open

| ID | Sev | Finding | Recommended action |
|---|---|---|---|
| P1-2 | P1 | Three historic invoices in the **development** database are over-paid (payments exceed the total). The new concurrency test shows the current code does not produce this; they predate the fix. | Finance decides: reverse or refund through the supported flows (never delete). |
| P1-3 | P1 | Hosting is blocked: both AWS accounts tried sit under an AWS Organizations policy that denies EC2/Lightsail. Out of scope this phase (no deployment allowed). | Owner of the organisation detaches the policy, or use a standalone account. |
| P2-2 | P2 | Phase 24 conditions C1-C9 remain open (see `docs/phase-24-certification.md`); verdict is still CONDITIONALLY READY. | Close before any production launch. |
| P2-3 | P2 | NFC has never been run on real hardware (Web NFC, USB readers, PC/SC bridge). The bridge program is not written. | Order samples, test, then decide (see `docs/nfc-hardware.md`). |
| P2-4 | P2 | Phase 26 Module F (AI campaign assistant) and Module G (event-triggered notifications, notification policies) not built. | Next phases. |
| P2-5 | P2 | Staff attendance via card (26B section 7): the specification text was cut off after the heading, nothing was built. | Provide the remainder of the specification. |
| P2-6 | P2 | No automated browser (UI) tests; UI was checked by build, typecheck, lint and earlier manual passes only. | Add Playwright smoke tests for login, scanner, payment. |
| P2-7 | P2 | Email authentication (SPF, DKIM, DMARC) guidance document not written; live email and WhatsApp providers never exercised. | Write guide; test with a sandbox account when one exists. |
| P3-1 | P3 | `GET /invoices/me/:id` answers 403 for another customer's invoice but 404 for a missing id, so existence can be distinguished (ids are unguessable cuids; no data leaks). | Return 404 for both. |
| P3-2 | P3 | Creating staff with a duplicate employee code returns 500 (unique-constraint error) instead of 409. | Map the Prisma error to a conflict response. |
| P3-3 | P3 | The mock supplier sells at cost, so flights have no margin and no incentive until a pricing rule exists. Correct behaviour, easy to mistake for a bug in a fresh install. | Documented below. |
| P3-4 | P3 | `image-quality.util.spec.ts` failed once under load (timing). | Investigate thresholds. |
| P3-5 | P3 | Local Docker is unstable under memory pressure. | More RAM, or run fewer things at once. |
| P3-6 | P3 | Test data (`example.test` contacts, `wf-*` staff and customers) remains in the databases it was created in. It is test-only and is not removed because nothing is deleted without being asked. | Clean the dev DB through the supported UI when wanted. |

No P0 (critical security, financial or data-loss) defect was found by the checks above. This is not a penetration test.

## 5. Changes made in this phase

* `apps/api/test/workflows.e2e-spec.ts` (new, 33 tests).
* `apps/api/src/modules/visa/visa.service.ts` and `visa.service.spec.ts` (P1-1 fix, 2 tests).
* `apps/api/prisma/seed.ts` (P2-1 feature flags, additive, idempotent).
* `apps/api/scripts/certification/{staff-cards,comm-contacts,comm-campaigns}-check.mjs` (corrected script bugs found while rerunning).
* `docs/phase-27-integration-report.md` (this file), `docs/nfc-hardware.md`.
* Earlier in the same phase (already committed or in the working tree): NFC backend and UI, Communication Centre, migration
  `20261016010000_phase26b_nfc_cards` (additive: 3 tables, enums, 3 columns). All 54 migrations apply from scratch and
  `migrate deploy` reports nothing pending on the test database.
* Test-data side effects of the workflow suite in `alnajoum_erp_test`: invented staff/customers, one default incentive policy
  (only if none existed), Hajj test packages, feature flag rows. The 10% test pricing rule it creates is deactivated at the end.

## 6. Run and test guide (localhost)

```bash
docker compose up -d postgres redis             # database and cache
pnpm install
cd apps/api && cp .env.example .env             # then fill the placeholders; never commit .env
npx prisma validate && npx prisma generate
npx prisma migrate deploy                       # additive, safe on an existing database
npx prisma db seed                              # upserts only; creates roles, permissions, feature flags
pnpm start:dev                                  # API on http://localhost:4000/api/v1
cd ../web && pnpm dev                           # web on http://localhost:3000
```

Checks:

```bash
cd apps/api
npx tsc --noEmit                                # typecheck
npx jest                                        # unit tests (192 suites)
npx jest --config ./test/jest-e2e.json          # e2e on alnajoum_erp_test (never touches the dev database)
npx jest --config ./test/jest-e2e.json workflows --verbose   # only the cross-module workflows
node scripts/certification/staff-cards-check.mjs             # live checks against a running local API
node scripts/certification/nfc-cards-check.mjs
node scripts/certification/comm-contacts-check.mjs
COMMUNICATION_SCHEDULERS_DISABLED=true pnpm start:dev        # API mode used by comm-campaigns-check.mjs
node scripts/certification/comm-campaigns-check.mjs
docker exec -i alnajoum-postgres psql -U <user> -d <db> -At -F '|' < scripts/certification/financial-reconciliation.sql   # read-only
cd ../web && npx tsc --noEmit && npx eslint src && pnpm build
```

Notes: the e2e suite needs `apps/api/.env.test` pointing at `alnajoum_erp_test`; jest may need
`NODE_OPTIONS=--max-old-space-size=3072` on a small machine. To repeat the scenarios, run the commands above again; every
run uses unique names, so it can be repeated without cleaning up.

### Mock, sandbox and live

* Flights, payments, payouts, e-mail and WhatsApp use mock providers by default. Mock results are flagged `simulated` and the
  screens say so. The NFC mock reader is refused in production.
* `0000000000` as a staff bank account number makes the mock payout provider fail on purpose.
* Only placeholders belong in `.env.example`. Real keys go in the server environment, never in the repository.
* Before touching a database you care about: `pg_dump` first, run `migrate deploy` (never `migrate reset` or `db push --accept-data-loss`).

### Setup traps

* A fresh database needs `prisma db seed` or protected modules answer 403 (feature flags) and roles do not exist.
* After adding a permission in code, run `prisma db seed` again or admins get 403 until it syncs.
* Flights have no margin (and staff no incentive) until a flight pricing rule and a default incentive policy exist.
* NFC needs HTTPS (Web NFC) or the dev-only `http://localhost` exception; see `docs/nfc-hardware.md` for chips, readers and drivers.

## 7. What cannot be verified here

* NFC on real cards, phones and readers; the PC/SC bridge program (BLOCKED, NOT IMPLEMENTED).
* Live WhatsApp (Meta), e-mail (SMTP/provider), payment gateway, airline/GDS and bank payout (MOCKED only).
* Public hosting and domain: `Alnajoumtravelagency.com` on Cloudflare; AWS blocked by the organisation policy (BLOCKED).
* Browser-level UI behaviour and mobile layouts beyond build, lint and earlier manual checks (PARTIALLY VERIFIED).
* Legal or regulatory compliance (data protection, WhatsApp/e-mail marketing law, card scheme rules). Nothing here is a
  compliance certification.

## 8. Module status

| Module | Status |
|---|---|
| Auth, RBAC, tenant isolation, step-up, audit | VERIFIED (unit, e2e, live; tenant-scope registry test) |
| Customers, staff, branches, companies | VERIFIED |
| Flights (search, booking, ticketing, refunds, incentives) with mock supplier | VERIFIED / MOCKED supplier |
| Payments, invoices, ledger, wallet | VERIFIED (reconciliation clean on test DB; 3 historic dev-DB defects) |
| Visa (services, applications, incentives, payouts) | VERIFIED (P1-1 fixed) |
| Hajj / Umrah registrations and instalments | VERIFIED (Hajj in workflow suite; Umrah by existing unit tests) |
| Hotels, vehicle rental, corporate travel | PARTIALLY VERIFIED (unit tests; not in the workflow suite) |
| Staff ID cards (QR) | VERIFIED |
| NFC cards | MOCKED |
| Communication Centre (contacts, consent, campaigns, WhatsApp, e-mail) | MOCKED providers |
| Attendance by card | NOT IMPLEMENTED |
| AI campaign assistant, event notifications | NOT IMPLEMENTED |
| AWS hosting | BLOCKED |

## 9. Recommended next phase

1. Finance resolves the three over-paid invoices (P1-2) and the Phase 24 conditions (P2-2).
2. Order NFC samples and test them (P2-3); send the rest of the attendance specification (P2-5).
3. Add Playwright UI smoke tests (P2-6) and the small P3 fixes (P3-1, P3-2).
4. Unblock hosting (organisation policy or standalone AWS account), then deploy to a staging server first.
