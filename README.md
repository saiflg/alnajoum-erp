# Alnajoum Travel ERP Platform — Phase 1

Production-quality foundation for the Alnajoum Travel ERP: authentication,
role-based access control, and Company / Branch / Staff management. Built to
run entirely on localhost during development, with Oracle Cloud deployment
deferred to a later phase.

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
│   │   │   │   └── audit/     # audit log read + write
│   │   │   ├── app.module.ts
│   │   │   ├── bootstrap.ts   # shared app config (used by main.ts AND e2e tests)
│   │   │   └── main.ts
│   │   └── test/               # unit specs live beside their module; e2e here
│   └── web/                   # Next.js frontend (App Router, TypeScript, Tailwind)
│       └── src/
│           ├── app/
│           │   ├── login/
│           │   ├── admin/{dashboard,companies,branches,staff,roles}
│           │   ├── branch/dashboard, staff/dashboard,
│           │   │   finance/dashboard, portal/dashboard
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
- 19 permissions and 6 system roles (`SUPER_ADMIN`, `COMPANY_ADMIN`,
  `BRANCH_MANAGER`, `FINANCE_OFFICER`, `STAFF`, `CUSTOMER`)
- A bootstrap company ("Alnajoum Travel") with a Head Office branch
- A bootstrap Super Admin: **admin@alnajoum.travel / Alnajoum@2026**
  (change this password immediately after first login — there is no
  forced-change flow yet, that lands with the Notifications module)

## 4. Database schema (Prisma models)

| Model | Purpose |
|---|---|
| `Identity` | Auth principal: email/phone, password hash, type (CUSTOMER/STAFF), status, verification & lockout state |
| `Customer` | Customer-facing profile, 1:1 with an Identity |
| `Staff` | Internal ERP profile (company/branch/employee code/job title), 1:1 with an Identity |
| `Company` | Travel agency company record |
| `Branch` | Branch under a company, unique `(companyId, code)` |
| `Role` / `Permission` / `RolePermission` | RBAC catalogue |
| `IdentityRole` | Role grants per identity, optionally scoped to a company/branch |
| `RefreshToken` | Hashed, revocable refresh tokens |
| `AuditLog` | Append-only action log (auth events today; extensible via `entityType`/`entityId`) |

Full definitions: [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma).
One migration so far: `20260731134308_init`.

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

**Audit** (`/audit-logs`) — `GET ?entityType=&entityId=`.

**Health** — `GET /health` (public).

Every route other than `register`/`login`/`refresh`/`logout`/`health`
requires a valid access token (`JwtAuthGuard`, global) and, where
declared, specific permissions (`PermissionsGuard` + `@RequirePermissions`)
or roles (`RolesGuard` + `@Roles`).

## 6. Tests written

- **24 unit tests** (`pnpm test` in `apps/api`): `AuthService` (credential
  validation, lockout after repeated failures, registration conflicts,
  refresh token rejection paths, password change), `RbacService`
  (role CRUD guards, permission aggregation), `RolesGuard` /
  `PermissionsGuard`.
- **22 e2e tests** (`pnpm test:e2e` in `apps/api`, needs Docker running):
  full journey against a real, dedicated `alnajoum_erp_test` Postgres
  database — login, `/auth/me`, company/branch/staff creation, duplicate
  rejection, a Branch Manager's permissions being correctly restricted
  (403 on company create/staff delete, 200 on branch read), refresh-token
  rotation and reuse rejection, logout revocation, customer
  self-registration and validation. Test data uses a per-run random
  suffix so the suite is safely re-runnable without ever needing a
  destructive database reset.
- **Frontend**: manually verified in-browser (see below) — Phase 1 does
  not yet include a frontend test runner; add Playwright/Vitest in Phase 2
  once portal features exist to justify the investment.

## 7. Manual verification performed

Both servers were run locally and exercised through the actual UI:
login as the bootstrap Super Admin → correct redirect to
`/admin/dashboard`; created a company and a branch via the forms; staff
list/roles pages render live API data; logging out returns to `/login`
and blocks further access; logging in as a `CUSTOMER` account redirects
to `/portal/dashboard`, and manually visiting `/admin/dashboard` while
authenticated as that customer correctly bounces back to their own
dashboard instead of granting access or dead-ending at `/login`.

## 8. Remaining tasks (explicitly out of Phase 1 scope)

- Forced password change on first staff login; email/SMS delivery of
  temporary credentials (depends on the Notifications module).
- Email/phone verification flows (columns exist on `Identity`; no
  send/verify endpoints yet).
- Two-factor authentication (schema field reserved; not implemented).
- The 22-page public marketing website and the Customer/Staff/Admin
  portal *features* (flights, hotels, visas, Hajj/Umrah, wallets, CRM,
  etc.) — only the routing shell and role-based redirect exist today.
- Role/permission management UI beyond read-only viewing (create/edit
  custom roles via the API works; there's no admin screen for it yet).
- Rate limiting is a flat global default (100 req/min); login-specific
  throttling should be tightened before production.

## 9. Risks

- **Temporary staff passwords are returned once, in-band, with no
  delivery channel** — acceptable for Phase 1 admin testing, but must not
  reach production before the Notifications module ships.
- **`ROLE_DASHBOARD_PRECEDENCE` is a fixed list** — an identity with
  multiple roles always lands on the highest-precedence dashboard; this
  is a deliberate simplification and will need a role-switcher UI once
  users commonly hold more than one role.
- **Cookie-based auth relies on `localhost` cookie sharing across ports**
  (3000 ↔ 4000), which works in this dev setup but will need explicit
  CORS/cookie-domain configuration for any non-localhost environment.
- **No CI pipeline yet** — tests are verified to pass locally but aren't
  gated on push. Add before Phase 2 lands multiple contributors.

## 10. Recommendations for Phase 2

1. Wire up the Notifications module (email/SMS/WhatsApp) so staff
   onboarding and password resets don't rely on manually relayed
   temporary passwords.
2. Build the Customer Management module properly (documents, family
   members, KYC) — the `Customer` table today is intentionally minimal.
3. Add a CI workflow running `pnpm lint`, `pnpm test`, and the e2e suite
   (with a disposable Postgres service container) on every PR.
4. Introduce Playwright for frontend e2e coverage once there are
   real portal features worth testing beyond CRUD forms.
5. Begin the Flight Booking module behind the existing RBAC/permission
   system — add `flight:*` permission keys following the established
   `<module>:<action>` convention.
