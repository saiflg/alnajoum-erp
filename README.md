# Alnajoum Travel ERP Platform

**Phase 1** (auth, RBAC, Company/Branch/Staff management) plus two Phase 2
modules: **Customer Management** (self-service profiles + document uploads)
and **Family Management** (dependents per customer, each with their own
documents). Built to run entirely on localhost during development, with
Oracle Cloud deployment deferred to a later phase.

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
│           │   ├── login/
│           │   ├── admin/{dashboard,companies,branches,staff,customers,roles}
│           │   ├── branch/dashboard, staff/dashboard,
│           │   │   finance/dashboard, portal/{dashboard,profile,family}
│           │   └── layout.tsx, page.tsx
│           ├── components/    # AppShell, ProtectedRoute
│           └── lib/           # api client, auth context, types
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
- 22 permissions and 6 system roles (`SUPER_ADMIN`, `COMPANY_ADMIN`,
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

Full definitions: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).
Migrations: `20260731134308_init`, `20260731172525_customer_management`,
`20260731191249_family_management`.

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

**Audit** (`/audit-logs`) — `GET ?entityType=&entityId=`.

**Health** — `GET /health` (public).

Every route other than `register`/`login`/`refresh`/`logout`/`health`
requires a valid access token (`JwtAuthGuard`, global) and, where
declared, specific permissions (`PermissionsGuard` + `@RequirePermissions`)
or roles (`RolesGuard` + `@Roles`).

## 6. Tests written

- **51 unit tests** (`pnpm test` in `apps/api`): `AuthService` (credential
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
  regardless of actual content).
- **65 e2e tests** across 4 spec files (`pnpm test:e2e` in `apps/api`, needs
  Docker running): full journeys against a real, dedicated
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
  - Test data uses a per-run random suffix so the suite is safely
    re-runnable without ever needing a destructive database reset.
- **Frontend**: manually verified in-browser (see below) — no frontend
  test runner yet; add Playwright/Vitest once there are more portal
  features worth testing beyond CRUD forms.

## 7. Manual verification performed

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

## 8. Remaining tasks (explicitly out of scope so far)

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
- The 22-page public marketing website and the Staff/Admin portal
  *features* (flights, hotels, visas, Hajj/Umrah, wallets, CRM, etc.) —
  only the routing shell and role-based redirect exist today.
- Role/permission management UI beyond read-only viewing (create/edit
  custom roles via the API works; there's no admin screen for it yet).
- Rate limiting is a flat global default (100 req/min); login-specific
  throttling should be tightened before production.

## 9. Risks

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
- **No CI pipeline yet** — tests are verified to pass locally but aren't
  gated on push. Add before more contributors join.

## 10. Recommendations for what's next

1. Wire up the Notifications module (email/SMS/WhatsApp) so staff
   onboarding and password resets don't rely on manually relayed
   temporary passwords.
2. Add a CI workflow running `pnpm lint`, `pnpm test`, and the e2e suite
   (with a disposable Postgres service container) on every PR.
3. Introduce Playwright for frontend e2e coverage once there are
   real portal features worth testing beyond CRUD forms.
4. Begin the Flight/Hajj/Umrah booking modules behind the existing
   RBAC/permission system — `Customer` and `FamilyMember` are now both
   in place as the traveler records those bookings will reference. Add
   `flight:*` / `hajj:*` permission keys following the established
   `<module>:<action>` convention.
5. Add a document verification status (`PENDING`/`APPROVED`/`REJECTED`)
   to `CustomerDocument`/`FamilyMemberDocument` once a KYC review
   workflow is needed — the current schema deliberately leaves this out
   until there's a concrete reviewer UI to attach it to.
