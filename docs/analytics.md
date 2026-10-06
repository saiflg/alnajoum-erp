# Executive analytics (Phase 20)

Status: **a tested metric layer, tenant/branch-safe analytics API, data-quality report and executive dashboard are built.** It is *not* a physical data warehouse — see [What this is not](#what-this-is-not). Localhost/test only; nothing here has been deployed.

## Why it exists

The Phase 20 audit found the same word meaning different things in different reports. "Revenue" alone had at least ten definitions (ledger cash, ticketed, completed, "not cancelled", all statuses, confirmed+ticketed…), null supplier costs were silently treated as zero (overstating margin), and almost every existing report was not tenant-scoped. The analytics layer fixes this for everything it serves by having **one definition per metric** and **one scope service** that every query goes through.

## What exists

| Piece | Where |
|---|---|
| Metric definitions (the single source of truth) | `apps/api/src/modules/analytics/engine/metric-definitions.ts` |
| Date ranges, comparisons, ageing buckets | `engine/periods.ts` |
| Time-series bucketing | `engine/buckets.ts` |
| Tenant / branch scope | `analytics-scope.service.ts` |
| Calculations | `metrics.service.ts` |
| Data-quality checks | `data-quality.service.ts` |
| API | `analytics.controller.ts` (`/api/v1/analytics/...`) |
| AI delegation | `executive_kpis` in `modules/ai/analytics-query-registry.ts` |
| Dashboard | `apps/web/src/app/admin/executive/page.tsx` (+ `components/analytics/*`) |
| Indexes | migration `20261008000000_phase20_analytics_indexes` |
| Demo history | `seedPhase20Analytics()` / `seedPhase20BranchDemo()` in `prisma/seed-demo.ts` |

## The metrics (definitions version 1.0.0)

Full text, caveats and sources are served by `GET /analytics/metrics` and shown on the dashboard's **Definitions** tab. Summary:

| Metric | Means | Dated by |
|---|---|---|
| `booked_value` | Price sold on active-sale flight + hotel bookings | booking `createdAt` |
| `bookings_count` | Number of those bookings | `createdAt` |
| `average_booking_value` | booked value / bookings (null when none) | `createdAt` |
| `cancellations` ≈ | Bookings in CANCELLED status | `updatedAt` (no cancelled-at column — approximate) |
| `gross_margin` | Sales minus supplier cost, **only where cost is recorded**, with cost coverage % | `createdAt` |
| `cash_collected` | Payments received on non-void invoices | `paidAt` |
| `receivables_outstanding` | Invoiced and unpaid now, aged **since issue** | as of now |
| `supplier_payables_outstanding` | Owed to suppliers now, aged past due date | as of now |
| `new_customers` | Customers created | `createdAt` |
| `active_customers` | Distinct customers with an active-sale booking | `createdAt` |
| `repeat_customer_rate` | Share of those who also booked before the period | `createdAt` |
| `support_tickets` | Tickets opened, SLA-breach rate, average first reply | `createdAt` |

**Active sale** = flight CONFIRMED / TICKETED / REFUND_REQUESTED / REISSUE_REQUESTED / REISSUED; hotel CONFIRMED / COMPLETED / REFUND_REQUESTED. PENDING, FAILED, CANCELLED and REFUNDED never count. The status lists live in code (`ACTIVE_FLIGHT_STATUSES`, `ACTIVE_HOTEL_STATUSES`) and the calculations import them — a definition and its number cannot drift apart.

"Booked value" is deliberately **not** called revenue. It is the price sold, not cash received and not accounting revenue.

## Honesty rules (and where they are enforced)

- **No fake comparisons.** A previous value of `null` → `NO_BASELINE`; a comparison window that ends before the tenant's first record → `INSUFFICIENT_DATA` ("Insufficient history"); a zero baseline → no percentage at all. (`compareValues`, tested.)
- **Like-for-like while a period is running.** "This month so far" is compared with the *same elapsed time* of the earlier period, never the whole of it — comparing 6 days with 30 was found live and fixed. (`comparisonRangeToDate`.)
- **Missing cost is never zero.** Margin covers only bookings with a recorded cost and reports the coverage %; with no costed bookings it is *unavailable*, not 100%.
- **Mixed currency is flagged, not summed.** Money totals use the company base currency; bookings in other currencies are excluded and counted in a visible warning. There is no FX history to convert them.
- **Unavailable means unavailable.** Metrics the data cannot support are listed with the reason and what would fix them (`UNAVAILABLE_METRICS`), and a metric that can't be shown for a selection (e.g. cash for one branch) returns `status: UNAVAILABLE` with a reason, not zero.
- **No forecasts.** Nothing is projected. The forecast entry says "Insufficient historical data" and exists so nobody mistakes the absence for an omission.
- **Freshness.** Every response is `freshness: LIVE` with `generatedAt`; nothing is cached or pre-aggregated, so no figure is older than its timestamp.

## Tenant and branch isolation

- The tenant **always** comes from the caller's token (`resolveTenantFilter`), never a parameter.
- `branchId` is validated against the caller's tenant: another company's branch is **404**, not 403.
- A caller without a company-wide role (anyone but SUPER_ADMIN / COMPANY_ADMIN / FINANCE_OFFICER / AUDITOR / REPORT_VIEWER — e.g. a branch manager) is **locked to their own branch**; asking for another is a 404, and a staff member with no branch sees nothing (sentinel), not everything.
- Bookings, tickets and invoices have no `companyId`, so scope goes through `customer.companyId`. The one raw-SQL query (trend) binds every value as a parameter; the granularity is validated against a fixed set.
- Tests assert the tenant id is present in **every** query a full overview issues.

## Permissions

| Permission | Grants | Default roles |
|---|---|---|
| `analytics:executive_view` | Sales, customer and support figures; trend; branches | COMPANY_ADMIN, FINANCE_OFFICER, AUDITOR, REPORT_VIEWER, BRANCH_MANAGER (own branch) |
| `analytics:finance_view` | Margin, cash, receivables, payables, cash trend | COMPANY_ADMIN, FINANCE_OFFICER, AUDITOR |
| `analytics:data_quality_view` | Data-quality report | COMPANY_ADMIN, FINANCE_OFFICER, AUDITOR |
| `analytics:definitions_view` | Metric definitions | all of the above |

Finance metrics are *omitted* (not blanked) for a caller without `finance_view`. The AI `executive_kpis` query additionally requires `executive_view`.

## API (`/api/v1/analytics`)

| Route | Permission | Notes |
|---|---|---|
| `GET overview` | executive | `preset`, `from`/`to` (custom, ≤ 3 years), `comparison`, `branchId` |
| `GET trend` | executive (cash: finance) | `metric` = booked_value / bookings_count / cash_collected; `granularity` day/week/month; max 400 points; empty periods are real zeros |
| `GET branches` | executive | every branch of the tenant incl. zero-sales ones |
| `GET metrics` | definitions | definitions + unavailable list |
| `GET data-quality` | data quality | read-only |

## Data quality

Read-only checks, each with a count, severity, the metrics it distorts and sample record **ids only** (no names or contact details): sales with no supplier cost, sales with no branch, sales in another currency, payments on voided invoices, payables with no due date, and (super admin only) invoices attributable to no company and reversed ledger entries. The report never changes data; the metrics layer excludes or flags bad rows by documented rule.

## AI

`executive_kpis` is registered in the approved query registry and delegates to `MetricsService.salesFigures`, so the assistant quotes the same number as the dashboard under the same scope. The model chooses a registered name and one clamped numeric parameter; it cannot supply a tenant, a branch or SQL (tested). The older flight-only queries (`total_ticket_sales`, `branch_sales`) are unchanged and still use their own CONFIRMED+TICKETED definition — they answer a narrower question and are named accordingly.

## What this is not

- **Not a physical data warehouse.** There are no fact tables, ETL jobs, snapshots or materialised views. Everything is computed live from transactional tables using grouped queries and the new date indexes. That keeps one source of truth and zero staleness, and is fine at current volume; the demo has ~100 bookings, so **performance at scale is untested**. The honest next step, when volume demands it, is a nightly per-tenant snapshot table — flagged `SNAPSHOT` with its own `computedAt` — rather than caching.
- **Not covering every service.** Booked value includes flights and hotels only. Visa, Hajj, Umrah, vehicle rental, corporate and package sales are not in these totals yet.
- **Not accounting.** No P&L, balance sheet or tax figures: the ledger has no company column and the existing platform P&L mishandles reversals (a pre-existing defect, left as found).

## Legacy report endpoints: tenant isolation (follow-up)

The Phase 20 audit found that the older per-module report endpoints did not filter by tenant. They now do. **This is an isolation fix only**: no figure was redefined and no response shape changed, with two documented exceptions (SUPER_ADMIN-only finance reports; provider-search counts).

How it works, everywhere: the tenant comes from the caller's token (`resolveTenantFilter`, via `AnalyticsScopeService`), never from a parameter; rows with no `companyId` are tied to a tenant through `customer.companyId` / `staff.companyId`; a SUPER_ADMIN is unfiltered (platform-wide) exactly as before; a caller with no company and no SUPER_ADMIN role is refused.

| Endpoint | What changed |
|---|---|
| `GET /flights/reports/kpis`, `/profit` · `/hotels/reports/kpis`, `/profit` · `/visa/reports/kpis`, `/profit`, `/status-breakdown` | Bookings/applications and every follow-up query (refunds, reissues, incentives) filtered by tenant. `branchId` goes through `AnalyticsScopeService`: another company's branch is **404**, and a branch manager is locked to their own branch. `staffId` must be a staff member of the caller's tenant (and, for a branch manager, own branch) or it is a **404**. `customerId` (visa status breakdown) is ANDed with the tenant filter, so another company's customer matches nothing. |
| `GET /flights/reports/provider-logs` | Only log rows tied to the caller's own bookings. |
| `GET /finance/reports/branches` | Only the caller's company's branches (a branch manager: their own); every figure re-filtered by tenant. |
| `GET /finance/reports/customer-statement/:customerId`, `/staff-incentive-statement/:staffId`, `/transaction/:type/:id` | Cross-tenant ids are **404**. A branch manager is held to staff of their own branch. |
| `GET /crm/reports/staff/:staffId`, `/customer-value/:customerId`, `/dashboard/branch/:branchId` | Cross-tenant ids are **404** (a branch manager: another branch is also 404). |
| `GET /crm/reports/dashboard/company`, `/dashboard/me`, `/staff/me` | Every count tenant-scoped (the unscoped `customer`/`lead`/`supportTicket` counts are gone). `/me` routes stay available to a staff member with no branch. |
| `GET /hajj-ops/reports/dashboard`, `/profitability/hajj\|umrah/:packageId` | Groups, departures, check-ins and fleet tenant-scoped; profitability counts only the caller's own registrations. |
| `GET /dashboard/search` | The `FlightSupplier` branch is now filtered by company like the others. |

### Deliberate exceptions and limitations (read these)

1. **`/finance/reports/profit-and-loss`, `/cash-flow`, `/dashboard` are SUPER_ADMIN-only (403 for everyone else).** `JournalEntry` / `LedgerAccount` / `CompanyInvestment` have no `companyId`, and joining through `sourceId` would be a guess. Company-level revenue/cash/receivables are in `/analytics/*` meanwhile. Fix properly by giving the ledger a company column. *Side effect:* the finance dashboard page loses the P&L / cash-flow / KPI panels for non-platform users (the branch table still loads).
2. **Provider searches have no booking, hence no tenant.** For a tenant caller `searches` in `/flights/reports/kpis` is `0`, and `providerSuccessRate` and `/provider-logs` cover only provider calls tied to their own bookings. SUPER_ADMIN's figures (including with a `branchId` filter) are unchanged.
3. **Hajj/Umrah packages are a shared catalog with no owner** (`HajjPackage`/`UmrahPackage` have no `companyId`, and the package list endpoints are not tenant-scoped either). The profitability endpoints count only the caller's own registrations; a package whose registrations all belong to *other* companies is a 404; a package nobody has registered for yet shows zeros. A tenant can therefore still see a shared package's name/currency through the catalog. Needs a package owner column to close.
4. **Hajj/Umrah groups are attributed through their pilgrims' customers or their coordinator**; a group with neither is unattributable and counted for SUPER_ADMIN only. **Fleet vehicles/drivers have no owner at all**, so a tenant's dashboard counts only those used by its own groups' transports (a never-used vehicle is invisible to tenants). `checkInsToday` is joined in SQL through the pilgrim's registration.
5. **CRM:** a lead is a tenant's if its assigned branch *or* assigned staff is; an unassigned lead is counted for SUPER_ADMIN only. Campaigns have no company column and are attributed through the staff member who created them (a campaign with no creator: SUPER_ADMIN only).
6. **Company-wide dashboards are not branch-locked** (`/crm/reports/dashboard/company`, `/hajj-ops/reports/dashboard`, by-id customer endpoints): they have no branch dimension, so a branch manager still sees their *company's* totals. Branch-dimension reports (flights/hotels/visa/finance branches/CRM branch dashboard/staff by id) *are* locked.
7. **Behaviour change for non-company-wide roles** (BRANCH_MANAGER, STAFF) on the flights/hotels/visa/finance-branches reports: they now see only their own branch (a staff member with no branch sees nothing), where before they saw everything.
8. Tests: each service has a spec asserting the tenant id appears in **every** query it issues (`common/testing/tenant-scope.testkit.ts`), a cross-tenant 404 per by-id endpoint, branch-manager locking, and that SUPER_ADMIN stays unfiltered.

## Known limitations and open risks

1. **Legacy report endpoints — fixed for tenant isolation, with the exceptions listed in [Legacy report endpoints](#legacy-report-endpoints-tenant-isolation-follow-up) below.** They still use their own (older) definitions, so their figures can differ from `/analytics`; that is unchanged. The ledger-backed finance reports are now SUPER_ADMIN-only because the ledger has no company column.
2. Receivables ageing is days *since issue*, because invoices have no due date.
3. Cancellation dates are approximate (`updatedAt`).
4. No exports, scheduled reports, alerts/anomaly detection, forecasting, cohort analysis, supplier scorecards or staff leaderboards.
5. The Phase 20 demo seed is deterministic synthetic history (prefix `ANL-`), with deliberately bad rows; it is not real data.
6. Customers/tickets in the demo carry no search or channel data — see the unavailable list.

## Running it locally

```bash
cd apps/api
npx jest src/modules/analytics src/modules/ai       # 100+ tests
npx prisma db seed                                  # syncs the new permissions
# demo history (idempotent):
$env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; npx ts-node prisma/seed-demo.ts
```

Demo logins (password `Demo@2026`): `ibrahim.musa@demo.alnajoum.travel` (finance officer, whole company), `ayo.bello@demo.alnajoum.travel` (branch manager, Abuja only), `admin@zamzamhorizon.demo.alnajoum.travel` (a second company — see only its own numbers). Dashboard: `/admin/executive`.
