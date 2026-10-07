# Workflow automation (Phase 21)

Status: **a tested, durable workflow engine with an admin builder and control centre.** It runs on localhost with mock providers only. It is deliberately smaller than the full Phase 21 brief — see [What is not built](#what-is-not-built). Nothing here is deployed.

## What it is

A workflow is **data, never code**: a small graph of typed steps (Trigger → Condition / Action / Approval / Delay / Wait / Escalation → End). Administrators build it with forms; the engine interprets it. There is no way to supply a script, an expression, a regular expression or SQL.

```
event published ──▶ durable event log ──▶ dispatcher ──▶ execution (pinned to a version) ──▶ steps
                         ▲                    ▲                      │
   domain services ──────┘     scheduler tick ┘ (one cron, row leases)└─▶ dead-letter queue ◀── human
```

| Piece | Where |
|---|---|
| Event bus (durable outbox) | `modules/workflows/events/workflow-event-bus.service.ts` (global module) |
| Dispatcher (event → executions, wakes waiters) | `workflow-dispatcher.service.ts` |
| Executor (runs steps, retries, dead-letters) | `workflow-executor.service.ts` |
| Scheduler (one tick: schedules, recovery, due runs) | `workflow-scheduler.service.ts` |
| Management API | `workflows.service.ts`, `workflows.controller.ts`, `automation.controller.ts` |
| Pure engine (no I/O, fully unit-tested) | `engine/` — conditions, template, graph, schedule, retry, loop-guard, rate-limit, redact, lifecycle, simulate, catalog |
| Actions | `actions/` |
| Admin UI | `/admin/workflows`, `/admin/workflows/[id]`, `/admin/automation` |
| Tables | `workflow_definitions`, `workflow_versions`, `workflow_events`, `workflow_executions`, `workflow_execution_steps`, `workflow_dead_letters`, `workflow_rate_counters` |

## Safety model

- **Conditions** (`engine/conditions.ts`): AND/OR/NOT over `field operator value`. 16 operators. Field paths are plain dotted names; `__proto__`, `constructor`, `prototype`, brackets, calls and spaces are rejected. Absent data never throws. No coercion (`"100"` is not `100`).
- **Templates** (`engine/template.ts`): `{{path}}` substitution only — no expressions, filters, helpers or loops. An unknown variable is an error, not a blank. HTML output is escaped. Substituted text is never re-evaluated.
- **Actions** are a closed, reviewed list. An author picks one by key; nothing can be added by configuration. A workflow cannot use an action its **author** lacks the permission for (checked at save, test and activation) — automation is not a privilege-escalation path.
- **No action in this phase moves money.** The only side effects are internal tasks, timeline notes, audit notes, custom events, and customer messages.
- **Activation gate** (`workflow-validation.ts`): trigger exists and is real, graph is acyclic with no unreachable or dead-end steps, every branch connected, timeouts valid, every action's config valid, every template variable available from the trigger, retry policy valid, author permitted. An invalid workflow can be saved as a draft but **cannot** be tested-for-real or activated.
- **Versions are immutable once tested or activated.** Editing creates the next version (with a reason). A run is pinned to the version it started under.
- **Tenant isolation:** every table carries `companyId`; every lookup is bound to the caller's company from the token; a cross-tenant id is 404. Actions re-check the customer / staff belong to the workflow's company. Events with no company start nothing.
- **Idempotency:** one execution per (workflow, event) — unique key, so a replayed event is harmless; one side effect per step — a `SUCCEEDED` step is never re-run and the action receives a per-step key (`ex:<execution>:node:<node>`) that the message sender, task creator and timeline writer all dedupe on; the event bus dedupes on a caller-supplied key.
- **Loops:** every emitted event carries its cascade chain; A→B→A, a chain deeper than 5, and a replayed event are refused and recorded (a dead-lettered run), not silently dropped. `event.emit` can only emit `custom.*`, never a real domain event.
- **Retries:** exponential backoff, capped; permanent errors are not retried; **financial actions are never auto-retried** (a human retries, with explicit confirmation).
- **Rate limits** (messages/minute, executions/minute…) are atomic in the database and **defer** work rather than dropping it.
- **Secrets:** event payloads and step output are redacted by key name (passwords, tokens, OTPs, card numbers, passport and account numbers…) before storage.
- **Test mode / dry run:** test runs the real engine with **mock actions** — nothing is sent, created or charged; delays and waits are skipped and approvals assumed. Dry run simulates without writing anything.

## Triggers

Available (each is published by a real service): `payment.succeeded`, `flight.ticket_issued`, `hotel.booking_completed`, `visa.status_changed`, `support_ticket.created`, `lead.created`, plus `schedule.<workflow>` (hourly / daily / weekly / monthly, Lagos time, one firing per window across any number of servers) and `custom.*` (emitted by another workflow).

Not available, with the reason shown in the UI (`engine/catalog.ts`): visa document events, installment due/overdue (no installment model, no invoice due date), flight schedule change (model exists, nothing detects it), quotations (no model), passport expiry, supplier/contract events, customer registered (will be published when the auth service is hardened), inventory/pricing/analytics events, agents/marketplace/corporate.

## Actions

`task.create`, `crm.timeline`, `notify.email`, `notify.sms`, `notify.push`, `notify.whatsapp` (through the WhatsApp module — consent and opt-out apply), `audit.note`, `event.emit`. Messages support English, Hausa and Arabic (chosen from the customer's preferred language, English fallback, right-to-left reported for Arabic). Approvals use the **existing approval engine** (`ApprovalsService`); the workflow owner cannot approve their own request, and an approval nobody decides is a dead letter, never assumed granted.

## Permissions

`workflow:view`, `create`, `edit`, `test`, `activate`, `pause`, `view_executions`, `retry_execution`, `cancel_execution`, `send_messages`. COMPANY_ADMIN has all; BRANCH_MANAGER, FINANCE_OFFICER and AUDITOR have view + view_executions. (The brief's `MANAGE_TEMPLATES` is not added: templates live inside the steps in this phase.)

## API

`/api/v1/workflows` (list, create, get, `PUT :id/versions`, `GET :id/validate`, `POST :id/test|dry-run|activate|resume|pause|disable|archive`) and `/api/v1/automation` (`catalog`, `metrics`, `events`, `executions`, `executions/:id`, `executions/:id/cancel`, `dead-letters`, `dead-letters/:id/retry|cancel|resolve`).

## Audit

`workflow.created`, `draft_saved`, `version_created`, `activated`, `paused|disabled|archived`, `tested`, `dry_run`, `execution_started|completed|failed`, `action_executed`, `execution_retried|cancelled`, `dead_letter_resolved`, `loop_prevented`, `note` — all with the company id and, for runs, the correlation id.

## What is not built

Be clear about the gap between this and the Phase 21 brief:

- **No money-moving actions** (payment links, refunds, payouts, supplier requests, booking changes, wallet changes). The framework supports FINANCIAL actions (never auto-retried, explicit confirmation to retry) but none exists. Document requests, quotations, finance/supplier tasks other than a generic task, and "update status" actions are likewise not built.
- **Many triggers are unavailable** — see above. Several brief examples (installment reminders, agent overdue payments, supplier contract expiry, failed-payout retry, customer reactivation) cannot work until the underlying data/events exist.
- **Only ONLINE payments** emit `payment.succeeded` today; staff-recorded, wallet and manually-approved payments do not.
- **Approval chains** are the existing count-based engine: no sequential/parallel/role-per-step approvals. The existing engine has no completion callback, so the executor polls it each minute.
- **No business calendar / SLA engine**: delays and escalations are wall-clock. The existing support SLA code is unchanged.
- **Existing crons are untouched.** The old reminder/CRM/visa/Hajj crons still run (and still re-send daily without memory — an audited pre-existing issue). New automation should be a workflow; migrating them is future work.
- **Templates are inline in steps**, not a central versioned library. The existing `MessageTemplate` table is still not used by any sender.
- **No visual drag-and-drop canvas**: the builder is a step list with forms and a running-order flow view. There is no graph library in the project.
- **No real-money, real-message or real-supplier test**: everything ran against mock providers.
- **Performance at volume is untested** (hundreds of executions, not thousands; a 4 GB machine).
- Workflows cannot yet be branch-scoped from the UI (the column and matching exist).

## Running it

```bash
cd apps/api
npx jest src/modules/workflows                    # ~280 tests: engine, executor, dispatcher, scheduler, service, actions
npx prisma db seed                                 # syncs the new permissions
$env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; npx ts-node prisma/seed-demo.ts   # 7 [DEMO] workflows + chidi.eze@demo.alnajoum.travel
```

Demo logins (password `Demo@2026`): `chidi.eze@demo.alnajoum.travel` (company admin — can build and activate), `ibrahim.musa@demo.alnajoum.travel` (finance officer — view only), `admin@zamzamhorizon.demo.alnajoum.travel` (another company — sees none of the first company's workflows). The seeded `[DEMO]` workflows are in status TESTING: review and activate one to see it react. The scheduler tick can be switched off with `WORKFLOW_SCHEDULER_DISABLED=true`.

## Troubleshooting

- *Workflow active but nothing happens* — check **Automation centre → Events**: was the event published and `PROCESSED`? Check the trigger condition (dry run shows it), and that the workflow is ACTIVE (paused/disabled ones ignore events).
- *A run is in "Needs attention"* — open **Inspect**: the step and reason are shown. Retry is refused for faults in the workflow itself (loop, bad graph, cross-tenant assignee, template error); fix the workflow, then cancel or resolve.
- *Events stuck PENDING* — the scheduler tick recovers them within about a minute; if the API runs with `WORKFLOW_SCHEDULER_DISABLED=true` it will not.
