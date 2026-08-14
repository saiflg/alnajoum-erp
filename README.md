# Alnajoum Travel ERP Platform

**Phase 1** (auth, RBAC, Company/Branch/Staff management) plus five Phase 2
modules: **Customer Management** (self-service profiles + document uploads),
**Family Management** (dependents per customer, each with their own
documents), **Flight Booking** (search/book/manage one-way, round-trip, and
multi-city flights, self-service or staff-assisted, against a swappable
provider — Mock today, Duffel once credentials exist), **Payments &
Invoicing** (an invoice is generated automatically the moment a flight
booking is confirmed; finance staff record cash/bank-transfer/POS/card
payments against it until it's paid), and **Notifications** (email sent on
staff onboarding, booking confirmation, payment receipt, and public contact
form submissions, against a swappable provider — Mock today, genuine SMTP
once credentials exist). A **public marketing website** (home, services,
about, contact, self-service registration) sits in front of all of it in
the same Next.js app, fully wired to the real API — the "Book a flight"
teaser on the homepage carries a search straight through registration into
a live, working flight search. Built to run entirely on localhost during
development, with Oracle Cloud deployment deferred to a later phase.

## 1. Project structure

```
alnajoum-erp/
├── docker-compose.yml        # Postgres 16 + Redis 7 for local dev
├── .env.example               # Template for docker-compose + reference values
├── pnpm-workspace.yaml        # pnpm workspaces (apps/*, packages/*)
├── turbo.json                 # Turborepo pipeline (build/dev/lint/test)
├── apps/
│   ├── api/                   # NestJS backend (Clean Architecture)
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts        # Bootstrap roles/permissions/company/admin
│   │   ├── src/
│   │   │   ├── common/        # decorators, guards, filters, interceptors, utils
│   │   │   ├── config/        # env validation (class-validator)
│   │   │   ├── infrastructure/prisma/  # PrismaService/PrismaModule
│   │   │   ├── modules/
│   │   │   │   ├── auth/      # login, register, refresh, logout, me
│   │   │   │   ├── rbac/      # roles, permissions, role assignment
│   │   │   │   ├── company/   # company CRUD
│   │   │   │   ├── branch/    # branch CRUD
│   │   │   │   ├── users/     # staff CRUD (internal ERP users)
│   │   │   │   ├── customers/ # self-service + admin customer profile CRUD
│   │   │   │   │   ├── documents/       # passport/ID uploads (local disk storage)
│   │   │   │   │   └── family-members/  # dependents per customer, incl. their own documents
│   │   │   │   ├── flights/   # search, book, manage flight bookings
│   │   │   │   │   ├── providers/  # FlightProviderPort + Mock/Duffel(stub) adapters
│   │   │   │   │   └── dto/
│   │   │   │   ├── payments/  # invoices + payments, self-service + admin/finance
│   │   │   │   ├── notifications/  # email send log
│   │   │   │   │   └── providers/  # NotificationProviderPort + Mock/Smtp adapters
│   │   │   │   ├── contact/   # public (unauthenticated) contact form endpoint
│   │   │   │   └── audit/     # audit log read + write
│   │   │   ├── app.module.ts
│   │   │   ├── bootstrap.ts   # shared app config (used by main.ts AND e2e tests)
│   │   │   ├── common/documents/  # shared multer/disk-storage config (namespaced)
│   │   │   └── main.ts
│   │   ├── uploads/            # local file storage root (gitignored)
│   │   └── test/               # unit specs live beside their module; e2e here
│   └── web/                   # Next.js frontend (App Router, TypeScript, Tailwind)
│       └── src/
│           ├── app/
│           │   ├── (marketing)/  # public site: home, about, services, contact
│           │   ├── privacy/, terms/  # legal pages, linked from the footer
│           │   ├── login/, register/
│           │   ├── admin/{dashboard,companies,branches,staff,customers,flights,invoices,notifications,roles}
│           │   ├── branch/dashboard, staff/dashboard,
│           │   │   finance/dashboard, portal/{dashboard,profile,family,flights,invoices}
│           │   └── layout.tsx
│           ├── components/    # AppShell, ProtectedRoute, CountrySelect, marketing/*
│           └── lib/           # api client, auth context, types, format helpers
└── packages/                  # reserved for future shared libraries
```

## 2. Architecture decisions

- **Identity split**: a single `Identity` table (credentials, JWT claims,
  verification/lockout state) is the one login system for the whole
  platform. It links 1:1 to either a `Customer` profile (public website /
  customer portal) or a `Staff` profile (internal ERP), so auth concerns
  stay separate from domain data while still giving one unified sign-in.
- **RBAC**: `Role` ↔ `Permission` (many-to-many via `RolePermission`) and
  `Identity` ↔ `Role` (via `IdentityRole`, optionally scoped to a
  `companyId`/`branchId`). Permission keys follow `<module>:<action>`
  (e.g. `company:create`). Roles/permissions are aggregated once at login
  and embedded in the short-lived access token, avoiding a DB round trip
  per request.
- **Unified login → role-based redirect**: every login/register/refresh
  response includes `dashboardPath`, resolved from a fixed role→path
  precedence table (`SUPER_ADMIN`/`COMPANY_ADMIN` → `/admin/dashboard`,
  `FINANCE_OFFICER` → `/finance/dashboard`, `BRANCH_MANAGER` →
  `/branch/dashboard`, `STAFF` → `/staff/dashboard`, `CUSTOMER` →
  `/portal/dashboard`). The frontend's `ProtectedRoute` component enforces
  this on every protected page, bouncing an authenticated-but-wrong-role
  user to their own dashboard rather than to `/login`.
- **Clean Architecture / SOLID**: each backend module separates
  controller (interface) → service (application logic) → Prisma calls
  (infrastructure), with cross-cutting concerns (auth guards, RBAC guards,
  validation, exception formatting) implemented once in `common/` and
  applied globally.
- **Refresh tokens**: opaque random tokens (not JWTs) stored server-side
  as a SHA-256 hash, so they can be revoked/rotated. Every refresh rotates
  the token (old one is marked revoked) and login/logout are audit-logged.
- **Customer documents on local disk**: uploads (passport/ID/visa scans)
  are written to `apps/api/uploads/customer-documents/` with a random
  filename; only the metadata (original name, mime type, size) lives in
  Postgres. Files are served through a guarded controller endpoint
  (ownership or `customer:read` permission checked before streaming) —
  never via `express.static` — since these are sensitive PII documents.
  This is a deliberate placeholder for the Oracle Cloud Object Storage
  migration planned once the platform leaves localhost.
- **Route ordering for nested resources**: `customers/me/...` and
  `customers/:customerId/...` share a path prefix but live in
  separate controllers; every `me`-rooted controller is registered before
  every `:customerId`-rooted one in `customers.module.ts` so Express
  never mis-matches `"me"` as a customer id — this holds for documents,
  family members, and family members' own documents alike. Covered by
  e2e tests for each pairing.
- **Family members reuse `customer:*` permissions**: rather than adding a
  separate `family-member:*` permission set, family members (and their
  documents) are treated as sub-resources of a `Customer` and gated by
  the same `customer:read`/`update`/`delete` checks — consistent with how
  customer documents are already scoped. Ownership is still enforced
  per-record (`FamilyMembersService.getMember` throws `Forbidden` if the
  member doesn't belong to the calling customer / the `:customerId` in
  scope), so this is an RBAC simplification, not a security shortcut.
- **Document storage is namespaced, not duplicated**: `createDocumentMulterOptions(namespace)`
  in `common/documents/` is shared by both customer documents
  (`customer-documents`) and family-member documents
  (`family-member-documents`), each writing to its own subfolder under
  `uploads/`. Adding a third document-bearing entity later (e.g. Staff)
  means calling the same factory with a new namespace, not rewriting
  multer config.
- **Passport photos are checked for blur before being accepted**:
  `common/documents/image-quality.util.ts` computes a Laplacian-variance
  sharpness score (a standard blur-detection heuristic) on any image
  uploaded with `?type=PASSPORT`; scores below `DOCUMENT_BLUR_THRESHOLD`
  (default 20) are rejected with a message asking the customer to
  retake the photo, and the just-saved file is deleted rather than left
  orphaned on disk. Only applies to `image/*` uploads with that specific
  document type — PDFs and other document types (national ID, visa,
  photo, vaccination/birth certificates) are never blur-checked. The
  threshold was calibrated against a synthetic document-like test image
  at increasing blur radii (see the "risks" section below for the
  caveat this implies) rather than real passport photos.
- **`FlightProviderPort` decouples booking logic from any one vendor**:
  `FlightsService` only ever calls `searchOffers`/`getOffer`/`createOrder`/
  `cancelOrder` on the interface in `modules/flights/providers/`, injected
  via the `FLIGHT_PROVIDER` DI token. Today that resolves to
  `MockFlightProviderService` (deterministic fake offers, no external
  calls); `DuffelFlightProviderService` exists as a documented stub that
  throws until implemented. Switching providers in any environment is one
  env var (`FLIGHT_PROVIDER=duffel`), not a rewrite of the booking flow.
- **Flight offers are held server-side, not round-tripped by the client**:
  like a real GDS, `MockFlightProviderService` caches each generated offer
  in memory (30-minute TTL) and hands back only an opaque id; `getOffer`/
  `createOrder` resolve against that cache. This is why offers don't
  survive a server restart and won't work across multiple API instances
  without a shared cache — acceptable for localhost, a real constraint to
  fix (e.g. Redis-backed) before any multi-instance deployment.
- **Booking passengers are snapshotted, not just referenced**: a
  `FlightBookingPassenger` copies the traveler's name/DOB/passport at
  booking time from either the `Customer` or a `FamilyMember`, the same
  snapshot pattern used for documents — so a later profile edit can't
  silently change what's on an already-booked ticket. Every passenger
  input identifies who they are by omitting `familyMemberId` (self) or
  providing one (a family member), and ownership is checked either way —
  the same shape is reused for self-service and admin/staff bookings.
- **One-way, round trip, and multi-city all share a single `legs[]` shape**:
  rather than modeling round trips as a special case with dedicated
  `origin`/`destination`/`returnDate` fields, every search and offer is just
  an ordered list of `{ origin, destination, departureDate }` legs — one
  leg for a one-way trip, two for a round trip, up to six for multi-city.
  `FlightsService.search` enforces the leg-count rules per `tripType`
  (exactly 1 for `ONE_WAY`, exactly 2 for `ROUND_TRIP`, 2+ for
  `MULTI_CITY`) rather than the DTO, since that's a business rule, not a
  shape constraint. `MockFlightProviderService` prices a round trip 10%
  below the same two legs booked as multi-city, modeling the bundled-fare
  discount real GDSs apply — and deliberately seeds its PRNG from the legs
  and cabin class only (not `tripType`), so the same underlying flights
  price identically whether they're bundled as a round trip or not; only
  the discount differs. `FlightBooking` keeps `origin`/`destination`/
  `departureAt` as summary columns (first leg's origin, last leg's
  destination, first leg's departure) for list display and indexing, while
  the full per-leg routing lives in the existing `itinerary` JSON snapshot
  — there's no separate `returnAt` column to special-case anymore.
- **Flight search is a `POST`, not a `GET`**: once search criteria became a
  nested `legs[]` array, encoding it into query-string parameters would
  have been more awkward than the request body it naturally is (Duffel's
  own API does the same for offer requests). It's read-only in effect but
  not idiomatically RESTful — a deliberate trade for a DTO class-validator
  can actually validate.
- **An invoice is generated in the same transaction as its flight booking,
  not after the fact**: `FlightsService.createBooking` wraps the
  `flightBooking.create` and `InvoicesService.createForFlightBooking` calls
  in one `prisma.$transaction`, so a booking can never exist without a
  matching invoice (or vice versa) even if the process crashes mid-request.
  `Invoice.flightBookingId` is nullable and unique rather than a required
  1:1 — every invoice today comes from a flight booking, but the shape
  stays valid for a future standalone invoice (a manual fee, say) that
  isn't tied to one.
- **Invoice status is derived, not set directly**: `ISSUED` /
  `PARTIALLY_PAID` / `PAID` is recomputed from the sum of recorded
  `Payment` rows every time a payment is added (`InvoicesService.
  recomputeStatus`), rather than being an independent field a caller could
  set inconsistently with the actual payment total. `VOID` is the one
  status recomputation never touches once set. Cancelling a booking voids
  its invoice automatically (`FlightsService.cancelBooking` →
  `voidIfUnpaid`) — but only when nothing has been paid against it yet; an
  invoice with payments already recorded needs a manual refund/
  reconciliation step rather than silently disappearing.
- **Payments are staff-recorded, not self-service**: there's no online
  payment gateway integrated yet (no Paystack/Flutterwave account to test
  against, same constraint that shaped the Duffel stub), so `payment:record`
  models how the agency actually takes payment today — cash, bank transfer,
  or POS in-office — logged by a staff member against `recordedByStaffId`.
  Recording payments is deliberately a narrower grant than viewing invoices:
  `COMPANY_ADMIN`/`FINANCE_OFFICER` hold both `invoice:read` and
  `payment:record`, while `BRANCH_MANAGER`/`STAFF` hold only `invoice:read`
  — the same separation-of-duties pattern as `flight:cancel` being withheld
  from `STAFF`.
- **Notifications never block the operation that triggered them**: staff
  creation, a flight booking, and a payment all call `NotificationsService`
  after their own write succeeds, and every send attempt — success or
  failure — is caught and recorded as a `Notification` row rather than
  thrown. A down mail server should never turn a successful booking into a
  500. Unlike `DuffelFlightProviderService`, the SMTP notification provider
  (`SmtpNotificationProviderService`) is a genuine working implementation,
  not a stub: SMTP is an open protocol usable with any mail server the
  deployer configures, not a vendor SDK requiring an account to be created
  on the agency's behalf, so there was nothing blocking a real
  implementation. `NOTIFICATION_PROVIDER=mock` (default) logs instead of
  sending, so the whole platform is exercisable without any mail
  credentials configured.
- **The public marketing site is a Next.js route group in the same app,
  not a separate project**: `(marketing)` shares the existing `AuthProvider`
  and `apiRequest`/cookie-auth plumbing that `/login` and every
  `/portal`/`/admin` page already use — "Log in" and "Get Started" on the
  homepage are the real, working auth flow, not placeholder links to a
  page that doesn't exist yet.
- **The homepage flight-search teaser is a genuine lead-through, not a
  fake demo widget**: since every route except a short public allowlist
  requires auth, an unauthenticated visitor's search can't hit
  `/flights/search` directly. Submitting the teaser instead carries
  `origin`/`destination`/`date` as query params through `/register` (or
  straight to the real search page if already signed in) — registration
  succeeds, and the visitor lands on `/portal/flights/search` with their
  original search already filled in and already run against the live
  mock provider. A real bug surfaced building this: the register page's
  "already signed in? bounce to dashboard" effect raced the post-register
  redirect and won, sending new users to `/portal/dashboard` instead of
  their intended search — fixed with a ref that suppresses the generic
  redirect for the duration of an in-flight registration.
- **The contact form is the one truly public write endpoint** in the API
  (`POST /contact`, `@Public()`), reusing `NotificationsService` to email
  the agency's inbox (not the visitor) and recording a `CONTACT_MESSAGE`
  `Notification` row — visible in the same admin notifications log as
  every other send, so "did the message actually go out" is answerable
  without needing real inbox access.
- **The footer ships with real, complete content rather than a stripped-
  down placeholder**: expanded service/company links, a "Legal" column
  linking to genuine `/privacy` and `/terms` pages (each carrying real
  NDPA/NDPR-aware boilerplate and an explicit "review before production"
  note, since this is a starting template rather than counsel-reviewed
  legal text), clickable `mailto:`/`tel:` contact details, business
  hours, and social-icon placeholders (`href="#"`, ready to point at the
  agency's real profiles once they exist). The intent was to make the
  footer something the business can hand off and edit — real headings,
  real structure, real (if placeholder) contact details — not a `TODO`
  banner.

## 3. Getting started (localhost)

Prerequisites: Node 20+, pnpm, Docker Desktop.

```bash
# 1. Start Postgres + Redis
docker compose up -d postgres redis

# 2. Install all workspace dependencies
pnpm install

# 3. Configure the API
cp .env.example apps/api/.env   # already done in this repo; edit secrets if needed

# 4. Apply migrations and seed Phase 1 data
cd apps/api
npx prisma migrate deploy   # or `prisma migrate dev` when changing the schema
npx prisma db seed

# 5. Run the API (http://localhost:4000/api/v1)
pnpm start:dev

# 6. Run the frontend (http://localhost:3000), in a second terminal
cd ../web
pnpm dev
```

The seed script creates:
- 27 permissions and 6 system roles (`SUPER_ADMIN`, `COMPANY_ADMIN`,
  `BRANCH_MANAGER`, `FINANCE_OFFICER`, `STAFF`, `CUSTOMER`)
- A bootstrap company ("Alnajoum Travel") with a Head Office branch
- A bootstrap Super Admin: **admin@alnajoum.travel / Alnajoum@2026**
  (change this password immediately after first login — there is no
  forced-change flow yet, that lands with the Notifications module)

## 4. Database schema (Prisma models)

| Model | Purpose |
|---|---|
| `Identity` | Auth principal: email/phone, password hash, type (CUSTOMER/STAFF), status, verification & lockout state |
| `Customer` | Customer-facing profile (name, DOB, nationality, gender, address/city/country, passport number/expiry), 1:1 with an Identity |
| `CustomerDocument` | Uploaded passport/ID/visa scans: type, original filename, stored filename, mime type, size |
| `FamilyMember` | Dependent linked to a `Customer` (relationship, name, DOB, nationality, passport info) |
| `FamilyMemberDocument` | Uploaded documents for a family member — same shape as `CustomerDocument` |
| `Staff` | Internal ERP profile (company/branch/employee code/job title), 1:1 with an Identity |
| `Company` | Travel agency company record |
| `Branch` | Branch under a company, unique `(companyId, code)` |
| `Role` / `Permission` / `RolePermission` | RBAC catalogue |
| `IdentityRole` | Role grants per identity, optionally scoped to a company/branch |
| `RefreshToken` | Hashed, revocable refresh tokens |
| `AuditLog` | Append-only action log (auth events today; extensible via `entityType`/`entityId`) |
| `FlightBooking` | A booking: customer, optional booking staff member, provider + provider order/offer ids, status, trip type (ONE_WAY/ROUND_TRIP/MULTI_CITY), summary route/departure/cabin, total, and a full `itinerary` JSON snapshot of the offer (every leg) |
| `FlightBookingPassenger` | One passenger on a booking — references a `Customer` or a `FamilyMember` (exactly one), plus a name/DOB/passport snapshot taken at booking time |
| `Invoice` | Billing record for a customer: status (ISSUED/PARTIALLY_PAID/PAID/VOID), currency, total, optional link to the `FlightBooking` it was generated from, optional issuing staff member |
| `InvoiceLineItem` | One charge line on an invoice (description + amount) — one per flight booking today |
| `Payment` | A staff-recorded payment against an invoice: amount, method (CASH/BANK_TRANSFER/POS/CARD/OTHER), optional note, recording staff member |
| `Notification` | Append-only send log (mirrors `AuditLog`): type (STAFF_TEMP_PASSWORD/BOOKING_CONFIRMATION/PAYMENT_RECEIPT/CONTACT_MESSAGE), recipient, subject/body, status (SENT/FAILED), error message |

Full definitions: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).
Migrations: `20260731134308_init`, `20260731172525_customer_management`,
`20260731191249_family_management`, `20260731195715_expand_document_types`,
`20260801133125_flight_booking`, `20260801182427_flight_multi_city`,
`20260802124631_payments_invoicing`, `20260804121945_notifications`,
`20260807182153_contact_message_notification`.

## 5. APIs implemented

All routes are prefixed `/api/v1`. Responses are wrapped as
`{ success: true, data: ... }`; errors as
`{ success: false, statusCode, message, path, timestamp }`.

**Auth** (`/auth`) — `POST register` (customer self-signup), `POST login`,
`POST refresh`, `POST logout`, `GET me`, `PATCH change-password`.

**RBAC** (`/rbac`) — `GET roles`, `GET permissions`, `POST roles`,
`PATCH roles/:id`, `DELETE roles/:id`, `POST identities/:id/roles`,
`DELETE identities/:id/roles/:roleId`.

**Companies** (`/companies`) — `POST`, `GET`, `GET :id`, `PATCH :id`,
`DELETE :id` (soft-deactivate).

**Branches** (`/branches`) — `POST`, `GET` (optional `?companyId=`),
`GET :id`, `PATCH :id`, `DELETE :id` (soft-deactivate).

**Staff** (`/staff`) — `POST` (creates Identity+Staff, returns a
one-time temporary password), `GET` (optional `?companyId=&branchId=`),
`GET :id`, `PATCH :id`, `DELETE :id` (deactivates).

**Customers** (`/customers`) — `GET` (admin list, `customer:read`),
`GET/PATCH me` (self-service profile, any authenticated customer),
`GET :id` / `PATCH :id` (admin view/update, `customer:read`/`customer:update`),
`DELETE :id` (admin deactivate, `customer:delete`).

**Customer documents** — self-service under `/customers/me/documents`:
`POST` (multipart upload, `?type=PASSPORT|NATIONAL_ID|VISA|OTHER`),
`GET` (list own), `GET :documentId/file` (download own), `DELETE :documentId`
(own only — cross-customer access returns 403). Admin equivalent under
`/customers/:customerId/documents`: `GET`, `GET :documentId/file`,
`DELETE :documentId`, gated by `customer:read`/`customer:delete`. Uploads
are capped at 5MB and restricted to JPEG/PNG/PDF.

**Family members** — self-service under `/customers/me/family-members`:
`POST`, `GET` (list), `GET :memberId`, `PATCH :memberId`, `DELETE :memberId`
(all scoped to the caller's own customer record — cross-customer access
returns 403). Admin equivalent under `/customers/:customerId/family-members`
with the same verbs, gated by `customer:read`/`customer:update`/`customer:delete`.

**Family member documents** — nested one level further:
`/customers/me/family-members/:memberId/documents` (self-service: `POST`
upload, `GET` list, `GET :documentId/file` download, `DELETE :documentId`)
and `/customers/:customerId/family-members/:memberId/documents` (admin:
same verbs, gated by `customer:read`/`update`/`delete` — the admin route
additionally allows staff-assisted uploads, since walk-in customers often
hand over physical documents for their dependents). Same 5MB/JPEG-PNG-PDF
limits as customer documents.

**Flights** (`/flights`) — `POST search` (body: `{ tripType:
ONE_WAY|ROUND_TRIP|MULTI_CITY, legs: [{ origin, destination,
departureDate }, ...], adults, children?, infants?, cabinClass? }` — 1 leg
for ONE_WAY, exactly 2 for ROUND_TRIP, 2-6 for MULTI_CITY, 400 on a
mismatch; any authenticated identity), `GET offers/:offerId` (offer
detail; 404 once expired/unknown).

**Flight bookings** — self-service under `/flights/bookings/me`: `POST`
(create, `{ offerId, passengers: [{ type, familyMemberId? }] }` — omit
`familyMemberId` to mean "the customer themself"), `GET` (list own),
`GET :id` (view own), `POST :id/cancel` (cancel own; 409 if already
cancelled). Admin/staff equivalent under `/flights/bookings`: `POST`
(book on behalf of an explicit `customerId`, `flight:book`), `GET`
(list all, optional `?customerId=&status=`, `flight:read`), `GET :id`
(view any, `flight:read`), `POST :id/cancel` (cancel any, `flight:cancel`).

**Invoices** — self-service under `/invoices/me`: `GET` (list own), `GET
:id` (view own, with line items and payments). Admin/finance equivalent
under `/invoices`: `GET` (list all, optional `?customerId=&status=`,
`invoice:read`), `GET :id` (view any, `invoice:read`), `POST
:id/payments` (record a payment — `{ amount, method:
CASH|BANK_TRANSFER|POS|CARD|OTHER, note? }`, `payment:record`; 400 if
`amount` exceeds the outstanding balance, 409 against a `VOID` or already
`PAID` invoice). An invoice is never created directly — one is generated
automatically, with a single line item, the moment a flight booking is
confirmed.

**Notifications** (`/notifications`) — `GET ?type=&status=` (admin/finance
list of every send attempt, `notification:read`). No admin send endpoint —
a notification is only ever produced as a side effect of staff creation, a
booking, a payment, or a public contact form submission.

**Contact** (`/contact`) — `POST` (public, no auth — `{ name, email,
subject, message }`), emails the agency and records a `CONTACT_MESSAGE`
notification. The only unauthenticated write route in the API besides
`auth/register`.

**Audit** (`/audit-logs`) — `GET ?entityType=&entityId=`.

**Health** — `GET /health` (public).

Every route other than `register`/`login`/`refresh`/`logout`/`contact`/`health`
requires a valid access token (`JwtAuthGuard`, global) and, where
declared, specific permissions (`PermissionsGuard` + `@RequirePermissions`)
or roles (`RolesGuard` + `@Roles`).

## 6. Tests written

- **102 unit tests** (`pnpm test` in `apps/api`): `AuthService` (credential
  validation, lockout after repeated failures, registration conflicts,
  refresh token rejection paths, password change), `RbacService`
  (role CRUD guards, permission aggregation), `RolesGuard` /
  `PermissionsGuard`, `CustomersService` (not-found/date-parsing/deactivation),
  `CustomerDocumentsService` (ownership checks on read and delete),
  `FamilyMembersService` (ownership checks on read/update/delete,
  date-parsing on create), `FamilyMemberDocumentsService` (ownership checks),
  `image-quality.util` (rejects a realistically Gaussian-blurred document
  photo and a flat/solid-color image, accepts a high-detail/noisy image,
  skips non-image mime types, and — a real bug caught during
  development — correctly accepts a *sharp* image that has an alpha
  channel, which `sharp`'s `.convolve()` previously scored as unreadable
  regardless of actual content), `MockFlightProviderService` (offer count/
  sorting, deterministic content for identical searches, correct leg count
  and ordering for one-way/round-trip/multi-city, the round-trip bundle
  discount priced against the identical legs booked as multi-city,
  cabin-class pricing, offer expiry via fake timers, order confirmation
  consuming the cached offer, order rejection once an offer is gone),
  `FlightsService` (passenger snapshot resolution for self vs. a family
  member, ownership rejection, provider-rejection → Conflict, booking
  ownership checks, double-cancel rejection, leg-count validation per
  trip type), `InvoicesService` (line-item generation from a flight
  booking, ownership checks on `getInvoice`, status recomputation across
  all four states, `voidIfUnpaid` correctly skipping invoices that already
  have a payment or don't exist), `PaymentsService` (rejects payment
  against a VOID or already-PAID invoice, rejects an amount exceeding the
  outstanding balance, records a valid payment and triggers status
  recomputation, accepts a payment that exactly zeroes the balance),
  `MockNotificationProviderService` (always reports success without
  sending anything), `NotificationsService` (records a SENT notification
  on provider success, a FAILED one with the provider's error message on
  failure, never throws even if the provider itself throws, renders the
  booking-confirmation template with route/total, lists with optional
  type/status filters, and sends a contact-form submission to the
  configured agency inbox — not the visitor — with the visitor's own
  email folded into the message body).
- **114 e2e tests** across 8 spec files (`pnpm test:e2e` in `apps/api`,
  needs Docker running): full journeys against a real, dedicated
  `alnajoum_erp_test` Postgres database —
  - **auth-rbac-flow**: login, `/auth/me`, company/branch/staff creation,
    duplicate rejection, a Branch Manager's permissions being correctly
    restricted (403 on company create/staff delete, 200 on branch read),
    refresh-token rotation and reuse rejection, logout revocation, customer
    self-registration and validation.
  - **customer-management**: self-service profile view/update, document
    upload/list/download/delete, unsupported file type rejection,
    cross-customer document access returning 403, admin list/view/update,
    a Branch Manager's read-only boundary (403 on update/delete), admin
    deactivation blocking the customer's next login, and passport blur
    validation (rejects a flat image, accepts a high-detail one, and
    confirms the blur check is scoped to `type=PASSPORT` only).
  - **family-management**: self-service family member CRUD plus per-member
    document upload/list/download/delete, cross-customer boundaries on the
    member record *and* its documents (403 both ways), admin create/view,
    a Branch Manager's read-only boundary (403 on create/update/delete),
    and the same passport blur rejection wired through the family-member
    upload path.
  - **flight-booking**: unauthenticated search rejected, correct leg count/
    ordering for one-way, round-trip, and multi-city searches, 400 on a
    leg count that doesn't match the declared `tripType`, offer detail
    lookup, 404 on an unknown/expired offer, the full self-service
    lifecycle (book → list → view → cancel → re-cancel returns 409),
    booking with a family member as a second passenger, a 3-leg multi-city
    booking correctly deriving `tripType`/summary `origin`/`destination`
    from the first and last leg, cross-customer boundaries on both a
    booking and a family member reference (403), staff booking on behalf
    of a customer with `flight:book`, a Branch Manager's read-only
    boundary (`flight:read` only — 403 on book/cancel), staff lacking
    `flight:cancel` being blocked from cancelling, and admin cancellation
    plus filtering the admin list by `status`.
  - **payments-invoicing**: booking a flight produces a matching `ISSUED`
    invoice with one line item describing it, cross-customer boundaries on
    an invoice (403) and on the admin invoices list for a plain customer
    (403, lacks `invoice:read`), STAFF/BRANCH_MANAGER able to read invoices
    but blocked (403) from recording a payment, a payment amount exceeding
    the balance rejected (400), a FINANCE_OFFICER's partial payment moving
    the invoice to `PARTIALLY_PAID` and the remaining balance moving it to
    `PAID`, a further payment against a `PAID` invoice rejected (409),
    cancelling an unpaid booking voiding its invoice, cancelling a
    fully-paid booking leaving its invoice untouched, and filtering the
    admin list by `status`.
  - **notifications**: creating a staff member records a SENT
    `STAFF_TEMP_PASSWORD` notification addressed to their email, booking a
    flight records a SENT `BOOKING_CONFIRMATION`, recording a payment
    records a SENT `PAYMENT_RECEIPT`, a plain customer is forbidden from
    the admin list (403, lacks `notification:read`), and the list can be
    filtered by `status`.
  - **contact**: an unauthenticated visitor can submit the public contact
    form with no auth token at all, the submission records a SENT
    `CONTACT_MESSAGE` notification visible via the admin notifications
    list with the visitor's email present in the body, a submission
    missing required fields is rejected (400), and an invalid email is
    rejected (400).
  - Test data uses a per-run random suffix so the suite is safely
    re-runnable without ever needing a destructive database reset.
- **Frontend**: manually verified in-browser (see below) — no frontend
  test runner yet; add Playwright/Vitest once there are more portal
  features worth testing beyond CRUD forms.

## 7. Continuous Integration

`.github/workflows/ci.yml` runs on every push/PR to `main`/`master`, as two
parallel jobs:

- **lint-and-build**: `pnpm install --frozen-lockfile` → generate the
  Prisma client → `pnpm lint` → `pnpm build` (both apps, via Turborepo).
- **test**: spins up `postgres:16-alpine` and `redis:7-alpine` as service
  containers, then runs `pnpm --filter api test` (unit) followed by
  `pnpm --filter api test:e2e`. No workflow-level env vars or secrets are
  needed — `apps/api/test/global-setup.ts` and `setup-env.ts` read
  `apps/api/.env.test` directly (it's committed, with non-sensitive dummy
  secrets), and the Postgres service's user/password/database name are set
  to match it exactly.

Both jobs were dry-run locally with the exact same commands before this
workflow was added, including a clean-slate check that `prisma generate`
doesn't require `DATABASE_URL` to already be set (it only reads the schema
file, so a fresh CI checkout without a local `.env` is fine). Getting the
repo to a genuinely clean `pnpm lint` was part of adding this, since a CI
gate that starts red teaches everyone to ignore it — that surfaced 141
real errors (mostly `@typescript-eslint/no-unsafe-*` on supertest's
untyped response bodies in e2e specs, relaxed via a scoped ESLint override
for `test/**` and `*.spec.ts`) plus a few genuine issues worth fixing
properly: two `any`-typed cookie reads in `auth.controller.ts` and
`jwt-access.strategy.ts` given explicit types, an unnecessary `async` on
`global-setup.ts`'s synchronous body, and a React `useEffect` in
`auth-context.tsx` restructured with an unmount guard (still needed an
explicit, documented rule exception — the "fetch on mount" idiom it
implements is legitimate but structurally triggers `react-hooks/set-state-in-effect`).

## 8. Manual verification performed

Both servers were run locally and exercised through the actual UI:
login as the bootstrap Super Admin → correct redirect to
`/admin/dashboard`; created a company and a branch via the forms; staff
list/roles pages render live API data; logging out returns to `/login`
and blocks further access; logging in as a `CUSTOMER` account redirects
to `/portal/dashboard`, and manually visiting `/admin/dashboard` while
authenticated as that customer correctly bounces back to their own
dashboard instead of granting access or dead-ending at `/login`.

Customer Management: logged in as a customer, edited and saved profile
fields on `/portal/profile`, uploaded a JPEG via the file picker and
confirmed it appears in the documents table with a working "View" link
that serves the correct bytes and content type; logged in as the Super
Admin and confirmed `/admin/customers` lists the customer with the saved
profile data, and the detail page's document "View" link also serves the
file correctly through the admin-scoped route.

Family Management: on `/portal/family`, added a family member (CHILD,
with DOB and nationality), confirmed it appeared immediately, expanded
its "Documents" panel and uploaded a JPEG, confirmed the upload request
hit the correctly-nested API route and the document appeared with a
working view link. Switched to the Super Admin account, opened the same
customer's detail page, and confirmed the family member and their
uploaded document both appear correctly in the new Family Members
section — including the document "View" link resolving through the
admin-scoped nested route and returning the right bytes/content-type.

Nationality/country fields and document types: confirmed both the
customer profile and family member forms (add and edit, portal and
admin) now use a country dropdown instead of free text, and that saving
persists correctly; confirmed the document-type dropdown shows the
expanded, human-readable list (Passport, National ID, Visa, Photo,
Vaccination Certificate, Birth Certificate, Other) everywhere a document
is uploaded or displayed.

Passport blur validation: uploaded a JPEG rendered from a canvas with
realistic passport-like text, both sharp and with an 8px CSS blur
applied, directly against the running API. The first pass of this
validation (variance-of-Laplacian with no pre-smoothing) let the
blurred image through — real photos retain enough JPEG-compression
block noise to fool a naive Laplacian check. Fixed by adding a light
Gaussian pre-blur to suppress compression noise before measuring edge
variance, and recalibrated the rejection threshold against a synthetic
document image at a range of blur radii (see `image-quality.util.ts`).
Re-ran the same sharp/blurred pair afterward: the sharp upload succeeds
(201) and the blurred one is rejected (400) with a message asking for a
clearer retake, confirmed via both the API directly and end-to-end tests.

Flight Booking: as a customer, confirmed the new "Book a Flight" and "My
Bookings" quick-link cards render on `/portal/dashboard`. Searched
`/portal/flights/search` for a real route and date; the mock provider
returned several offers with correctly formatted currency, date/time, and
duration (e.g. "Arik Air · W3498, LOS → ABV, Mon 15 Mar, 09:51, 3h 52m,
ECONOMY, ₦81,129, 4 seats left"). Selected an offer, landed on
`/portal/flights/book/[offerId]` with "Myself" pre-checked as ADULT and
the correct empty-state copy for a customer with no family members yet.
Submitted the booking and confirmed via the network log that
`POST /flights/bookings/me` returned 201 and the app redirected to the
new booking's detail page, which displayed the generated reference
(`ANJ-XXXXXXXX`), route, dates, cabin, total, `CONFIRMED` status, and
passenger table correctly. `/portal/flights` ("My Bookings") listed both
that booking and an earlier cancelled one with the right statuses.
Logged in as the bootstrap Super Admin and confirmed `/admin/flights`
lists bookings across customers with a working status filter (verified
narrowing to `CONFIRMED` correctly hid the cancelled row), and that the
admin detail page for the same booking renders identically with a
"Cancel booking" button shown (Super Admin holds `flight:cancel`). The
in-browser cancel action itself relies on a native `confirm()` dialog
that the browser automation tool can't drive, so the cancel/re-cancel
transition, cross-customer/family-member ownership boundaries, staff
booking-on-behalf, and permission gating (`flight:book`/`flight:cancel`)
were exercised through the e2e tests instead, which assert against the
real API and database rather than just mocks.

Multi-city flight booking: re-verified `/portal/flights/search` after the
legs-based redesign. One-way search (LOS → ABV) returned single-leg
offers unchanged. Switching to "Round trip" revealed a Return date field
and returned offers with both outbound and return legs listed, correctly
labeled "Round trip". Switching to "Multi-city" showed two leg rows by
default with a "+ Add another flight" control; added a third leg
(LOS → ABV → KAN → LOS across three dates) and confirmed the results
showed all three legs in order with a combined total. Booked the 3-leg
offer end-to-end: the confirmation page listed all three flights, the
booking detail page (both `/portal/flights/[id]` and the admin
equivalent) rendered them identically post-booking, and "My Bookings"
correctly summarized the trip as "LOS → LOS" (first origin, last
destination) in the list view.

Payments & Invoicing: booked a flight as a fresh customer and confirmed
`/portal/invoices` immediately showed a matching invoice in `ISSUED`
status with the balance due equal to the full total — generated
automatically, with no manual step. Opened the invoice detail page and
confirmed the single line item ("Flight ANJ-XXXXXXXX: LOS → ABV")
matched the booking total. Logged in as the bootstrap Super Admin,
confirmed `/admin/invoices` lists the invoice with the customer's name,
and recorded a partial payment (₦50,000 via bank transfer) through the
"Record a payment" form — the status flipped to `PARTIALLY_PAID` and the
balance recalculated correctly. Recorded a second payment for the exact
remaining balance and confirmed the status moved to `PAID`, the payments
table listed both with their references/methods/dates, and the payment
form itself disappeared once nothing was left to collect (mirroring the
409 the API returns for a payment against an already-`PAID` invoice).
Created a dedicated `FINANCE_OFFICER` staff account and confirmed their
`/finance/dashboard` shows a live "outstanding invoices" / "outstanding
balance" summary (correctly `0`/`₦0` once the test invoice was fully
paid) and a narrower nav (`Dashboard`, `Invoices` only) that still
resolves `/admin/invoices` correctly under that role. One real gap
surfaced during this pass and is worth calling out: the two new
permissions (`invoice:read`, `payment:record`) only take effect for an
identity after their *next* login, since permissions are computed once
at login time and embedded in the JWT — an already-issued session
doesn't pick up a newly-granted permission until it's refreshed. This is
consistent with how every other permission in the system already
behaves (not a new limitation introduced here), but it's easy to trip
over when testing locally against a long-lived dev session.

Notifications: hit the same JWT-permissions-cached-at-login gotcha again
— the dev database's `FINANCE_OFFICER`/`COMPANY_ADMIN` roles needed a
reseed to pick up `notification:read`, and a long-lived local session had
to log out and back in to pick up the new grant, confirmed directly
(decoded the fresh JWT and saw `notification:read` present) rather than
guessed at. Confirmed via the API that a staff creation, a flight
booking, and a payment each produce a `SENT` `Notification` row against
the mock provider. The `/admin/notifications` and Finance
`/admin/notifications` nav entries were confirmed to render for the
correct roles. A full in-browser click-through of the notifications list
page (expand-to-see-body, filter dropdowns) *was* later completed as part
of verifying the contact form below — that pass is also where a missing
`CONTACT_MESSAGE` option in the type filter's dropdown was caught and
fixed.

Public marketing website: ran through the entire public site as a fresh,
unauthenticated visitor. `/` renders the animated hero, scroll-reveal
sections, and count-up stats correctly; the header shows Login/Register
links (not "Go to Dashboard") when logged out. Used the homepage's
"Book a Flight" search teaser (LOS → ABV, a future date) while logged
out: it redirected to `/register?next=%2Fportal%2Fflights%2Fsearch&origin=LOS&destination=ABV&date=...`
as expected. The first attempt exposed a real race-condition bug —
after successful registration the app landed on `/portal/dashboard`
instead of the intended prefilled search page, because a generic
"already logged in → redirect to dashboard" effect fired after
`setUser()` and won the race against the intended `next`-aware redirect
in the submit handler. Fixed with a `justRegisteredRef` guard so that
effect only fires for a visitor who was *already* authenticated on page
load, not one who just registered in the current render cycle. Re-ran
the exact same flow afterward and confirmed via `read_page` that it
correctly lands on `/portal/flights/search` with all three fields
(origin, destination, date) prefilled and a live search already run
against the real API — not a static page. Also verified the teaser
redirects straight to the prefilled search (skipping registration) when
already logged in. Clicked through `/about` and `/services` (including
the anchor links from the footer resolving to the right section on
`/services`) and confirmed both render real content, not placeholders.
Submitted the `/contact` form as a visitor with a real name/email/
subject/message; confirmed the success state rendered, then logged in
as the Super Admin and confirmed the exact same message appeared as a
`SENT` `CONTACT_MESSAGE` row in `/admin/notifications`, with its body
showing the visitor's name/email and message text when expanded — this
is also where the type-filter dropdown was found to be missing the
`CONTACT_MESSAGE` option and fixed. Confirmed a rejected submission
(missing fields) is blocked client-side before it ever reaches the API.
Finally, ran the full test suites (102 unit / 114 e2e, all passing),
`pnpm lint` (clean), and `pnpm build` (clean, after fixing a frontend
`NotificationType` union that was still missing `'CONTACT_MESSAGE'` and
failed the production type-check) as the closing check for this phase.

Footer content: scrolled through the full homepage footer and confirmed
the expanded services list, social icons, `mailto:`/`tel:` links,
Business hours table, and the new Legal column render correctly; clicked
through to `/privacy` and `/terms` directly and confirmed both render
their full section content (title, "last updated" line, the explicit
review-before-production note, and every numbered section) rather than
404ing or rendering empty. Re-ran `pnpm lint` and `pnpm build` afterward
— both stayed clean with the two new routes included in the build output.

## 9. Remaining tasks (explicitly out of scope so far)

- Forced password change on first staff login; email/SMS delivery of
  temporary credentials (depends on the Notifications module).
- Email/phone verification flows (columns exist on `Identity`; no
  send/verify endpoints yet).
- Two-factor authentication (schema field reserved; not implemented).
- KYC-style document *review* workflow (approve/reject a submitted
  passport) — today documents are stored and retrievable but there's no
  verification status on `CustomerDocument` or `FamilyMemberDocument`.
- No admin upload UI for a customer's *own* documents (the admin can view
  and delete, matching that the primary account holder manages their own
  uploads) — only family-member documents have an admin upload path,
  since staff often collect those in person.
- The public marketing website now covers Home/About/Services/Contact
  plus real customer self-registration, all wired to the live backend —
  but it's 4 pages, not the originally-specced 22 (e.g. no dedicated
  per-destination pages, no blog/news, no FAQ, no legal/policy pages).
  The Staff/Admin portal *feature* pages beyond auth (hotels, visas,
  Hajj/Umrah, wallets, CRM, etc.) still only have flights/payments/
  notifications implemented — the rest is routing shell and role-based
  redirect only.
- Role/permission management UI beyond read-only viewing (create/edit
  custom roles via the API works; there's no admin screen for it yet).
- Rate limiting is a flat global default (100 req/min); login-specific
  throttling should be tightened before production.

## 10. Risks

- **Temporary staff passwords are returned once, in-band, with no
  delivery channel** — acceptable for admin testing today, but must not
  reach production before the Notifications module ships.
- **All documents (customer and family member) live on local disk**, not
  object storage — fine for one developer on localhost, but doesn't
  survive container restarts in a multi-instance deployment. Must move
  to Oracle Cloud Object Storage (or equivalent) before any
  shared/production environment.
- **No malware/content scanning on uploads** — the API validates
  MIME type, size, and (for `type=PASSPORT`) a blur/readability heuristic
  only, never file contents for malicious payloads. Add a scanning step
  before accepting uploads in a public-facing deployment.
- **The passport blur check is a heuristic, not a calibrated or
  ML-based classifier** — it was tuned against a synthetic document-like
  test image at a handful of blur radii, not a real dataset of blurry vs.
  sharp passport photos. It will catch clearly out-of-focus photos and
  flat/blank frames, but the exact threshold (`DOCUMENT_BLUR_THRESHOLD`)
  may need adjusting once real user uploads are observed — too strict
  rejects legitimate photos taken in low light or at an angle; too loose
  lets genuinely illegible photos through. Treat it as a first line of
  defense, not a guarantee, until it can be validated against real
  submissions or replaced with a proper document-quality ML service.
- **`ROLE_DASHBOARD_PRECEDENCE` is a fixed list** — an identity with
  multiple roles always lands on the highest-precedence dashboard; this
  is a deliberate simplification and will need a role-switcher UI once
  users commonly hold more than one role.
- **Cookie-based auth relies on `localhost` cookie sharing across ports**
  (3000 ↔ 4000), which works in this dev setup but will need explicit
  CORS/cookie-domain configuration for any non-localhost environment.
- **CI runs lint/build/tests but isn't yet a required check** — the
  workflow exists (`.github/workflows/ci.yml`) and passes, but branch
  protection to actually block merges on a red run hasn't been configured
  (that's a GitHub repo setting, not something in this codebase — set it
  up once this repo has a remote and more than one contributor).

## 11. Recommendations for what's next

1. **Deploy to Oracle Cloud Free Tier** — explicitly requested next by
   the project owner now that the public marketing site is live and
   genuinely wired to the real backend (register/login from `/`, real
   flight search, real contact form). An Always Free Ampere A1 compute
   instance (4 OCPU/24GB, enough for Postgres + Redis + both Node apps)
   is the natural target. Needs: a step-by-step provisioning guide
   (instance shape, VCN/security-list rules for 80/443, a reverse proxy
   in front of the Next.js and Nest processes, TLS via Let's Encrypt,
   swapping local-disk document storage for Oracle Cloud Object Storage
   per the risk noted above, and environment/secrets configuration for
   production `DATABASE_URL`/`JWT`/`SMTP` values). Not started yet.
2. Introduce Playwright for frontend e2e coverage once there are
   real portal features worth testing beyond CRUD forms.
3. Integrate a real online payment gateway (Paystack/Flutterwave are the
   standard choices for a Nigeria-based agency) behind a
   `PaymentProviderPort`-style seam, mirroring how `FlightProviderPort`
   decouples Duffel from the booking flow — today every payment is
   staff-recorded (cash/bank transfer/POS/card typed in after the fact),
   with no customer-initiated checkout.
4. Add SMS/WhatsApp as a second `NotificationProviderPort` channel
   alongside email (Termii/Africa's Talking are the standard choices for
   a Nigeria-based agency) — the port is already channel-agnostic in
   spirit, just email-only in practice today.
5. Begin the Hotel/Hajj/Umrah booking modules behind the existing
   RBAC/permission system, reusing the same provider-abstraction and
   auto-invoice-on-confirmation patterns established for flights —
   `Customer` and `FamilyMember` are already in place as the traveler
   records those bookings will reference. Add `hotel:*` / `hajj:*`
   permission keys following the established `<module>:<action>`
   convention.
6. Add a document verification status (`PENDING`/`APPROVED`/`REJECTED`)
   to `CustomerDocument`/`FamilyMemberDocument` once a KYC review
   workflow is needed — the current schema deliberately leaves this out
   until there's a concrete reviewer UI to attach it to.
7. Expand the marketing site toward the originally-specced ~22 pages
   (per-destination landing pages, FAQ, blog/news, legal/privacy/terms)
   once there's real content to put on them.
