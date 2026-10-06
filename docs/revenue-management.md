# Revenue management (Phase 19)

Status: **core engine, rules, margin policy, promotions and price snapshots are built and tested. It is NOT yet wired into live bookings** — flight, hotel, visa, Hajj and Umrah still price exactly as before. See [Known limitations](#known-limitations).

## What exists

| Piece | Where |
|---|---|
| Money/rounding helper | `apps/api/src/common/utils/money.util.ts` |
| Pure pricing engine | `apps/api/src/modules/revenue/engine/pricing-engine.ts` |
| Rule JSON validation | `engine/rule-validation.ts` |
| Promotion evaluator | `engine/promotion-evaluator.ts` |
| Customer-safe price view | `engine/price-view.ts` |
| Services / API | `revenue/*.service.ts`, `revenue.controller.ts` (`/api/v1/revenue/...`) |
| Tables | `pricing_rules`, `pricing_rule_versions`, `pricing_policies`, `pricing_traces`, `promotions`, `promotion_usages` |
| Demo data | `seedPhase19Revenue()` in `prisma/seed-demo.ts` — every rule is named `[DEMO] ...` |

## Money and rounding

Every amount is an `Int` in whole currency units, as everywhere else in the ERP. Percentages are rounded **half-up**, matching the `Math.round(amount * pct / 100)` the flight, refund and incentive code already uses (tests assert agreement). The maths is done in integer basis points, so there are no floating-point artefacts. **Percentages are honoured to two decimal places.** Negative, fractional or non-finite money values throw.

## The formula

```
supplier cost
+ markup                one winning rule
+ fees                  one winning rule PER fee type
+/- dynamic adjustment  one winning rule, clamped by its own limits
= subtotal
- discount              stored rules + promotions/coupons, capped by policy
= net before tax        <- what the agency earns on
+ exclusive tax         inclusive tax is reported, never added
= customer price

margin = (customer price - all tax) - supplier cost
```

With no tax rules, `margin = customer price - supplier cost`, which is the margin the ERP already reports. If the supplier price already includes tax (`taxIncludedInSupplierCost`), TAX rules are skipped and recorded as skipped, so tax is never counted twice.

## Rule precedence (explicit, never ambiguous)

When several rules compete for the same slot (the single markup, one fee type, one tax name, the non-stackable discount), the winner is chosen by, in order:

1. **Tier** — `CONTRACT` > `PRODUCT` > `SEGMENT` > `CAMPAIGN` > `CHANNEL`
2. **Priority** — higher wins
3. **Specificity** — more conditions set wins
4. **Version** — newer wins
5. **Rule id** — alphabetical, so the result is stable

This order is a business decision encoded as data (`TIER_ORDER`). Change it deliberately, not by accident. Every losing rule stays in the trace as `SUPERSEDED`, with the rule that beat it.

A rule only applies if it is active, inside its effective window, and **every condition it sets matches** (an unset condition matches anything; a bounded one such as `minPassengers` does not match an unknown value). Group tiers (1–4 / 5–9 / 10–19 / 20+) are ordinary rules with passenger ranges — nothing is hard-coded.

## Margin protection

A calculation returns `status: REQUIRES_OVERRIDE` — it never silently passes — when:

- margin is **negative** (always, even with no policy),
- margin is below the policy's `minAbsolute`, or
- margin % is below the policy's `minPercent`.

Policy lives in `pricing_policies`: a tenant's own policy beats the platform default, and a per-product override beats both. A `maxDiscountPercent` caps total discount. An override is accepted only from a caller holding `revenue:price_override`, with a written reason; the approver and reason are stored on the trace and written to the audit log (`revenue.margin_override_used`). The original calculation is kept in the trace.

## Dynamic pricing

A `DYNAMIC` rule maps a measured signal (`daysToDeparture` or `inventoryRemainingPercent`) to a percentage adjustment through configured **bands**. It must declare `maxMovementPercent`; it may also declare `minPrice`, `maxPrice` and `maxMarkupPercent`. A rule without a movement limit is rejected at save time. No AI chooses prices.

## Versioning and snapshots

Rules are never edited in place. Every change appends an immutable `pricing_rule_versions` row (full snapshot + reason) and bumps `currentVersion`. Updates use an optimistic lock, so two simultaneous edits cannot both win. A stored calculation (`pricing_traces`) records the breakdown, the full trace and the exact `{ruleId, version}` list, so a booking's price can be reproduced later even after rules change. Set `persist: true` with `sourceType`/`sourceId` to freeze one as a booking's commercial snapshot.

## Promotions and coupons

Server-side only. A promotion belongs to one company and is looked up with that company id, so another tenant's code is simply "invalid". Limits: window, products, channels, minimum booking, maximum discount, total uses, uses per customer, budget. Redemption runs in a transaction that **locks the promotion row** (`SELECT ... FOR UPDATE`), re-evaluates, then increments counters; a unique `(promotion, sourceType, sourceId)` key makes redeeming the same booking twice idempotent. A coupon that doesn't apply fails the pricing call with a 400 rather than being quietly ignored.

## Tenancy and privacy

- A tenant sees and edits only its own rules, plus read-only platform defaults (`companyId = null`), which only the super admin may change.
- Another tenant's rule or trace is **404**, never 403.
- Calculation endpoints return supplier cost and margin, so `revenue:pricing_view` is **staff-only**. A customer/mobile price view uses `toCustomerView()`, which omits supplier cost, markup, margin, rules and trace.
- Nothing accepts a final price from a client.

## API (all under `/api/v1/revenue`)

| Method & path | Permission | Notes |
|---|---|---|
| `POST price/preview` | `revenue:pricing_view` | Never stores anything |
| `POST price/calculate` | `revenue:pricing_view` | `persist: true` stores a trace |
| `GET traces/:id` | `revenue:pricing_view` | Tenant-checked |
| `GET/POST rules`, `GET rules/:id`, `GET rules/:id/versions`, `PATCH rules/:id` | view / `revenue:rule_manage` | Update requires a `reason` |
| `GET/PUT policy` | view / `revenue:policy_manage` | |
| `GET/POST promotions`, `PATCH promotions/:id` | `revenue:promotion_manage` | |
| `POST promotions/check`, `POST promotions/redeem` | `revenue:pricing_view` | |

Granted by default to COMPANY_ADMIN (all five) and FINANCE_OFFICER (view only).

## Known limitations

These are real gaps, not hidden ones. See the Phase 19 report for the full list.

- **Not connected to bookings yet.** Flights still use `FlightPricingService`; hotels, visa, Hajj/Umrah and vehicle rentals keep their flat prices. Wiring the engine in, and snapshotting at confirmation, is the next step. Doing it safely means deciding how existing `FlightPricingRule` rows map onto the new ones.
- **No agent/reseller/B2B/marketplace/white-label/quote model exists in the ERP** (the audit found none), so the engine has the *conditions* for them (`agentId`, `channel`, `corporateAccountId`) but there is nothing to feed them yet.
- **Single currency per calculation.** The engine does not convert currency; the existing currency table has no rate source or history, and only converts to NGN.
- **Tax rules in the engine are pricing rules**, separate from the existing (unused) `TaxRule` table; consolidating them is future work.
- **Finance posting is not changed.** There is still no discount or tax-payable ledger account, so a discount lowers revenue silently in the ledger. That needs an accounting decision before the engine drives real bookings.
- Not built: forecasting, dashboards, AI revenue assistant, competitor-price references, discount-approval workflow, price locks, fraud events, partner API keys. The approval engine needs a polling sweep (it has no completion callback), and API keys are not yet accepted by any guard.

## Running the tests

```bash
cd apps/api
npx jest src/modules/revenue src/common/utils
```
