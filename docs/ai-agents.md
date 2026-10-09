# AI agent layer (Phase 23)

**Status: LOCALHOST / TEST ONLY.** Everything here runs against the built-in *mock* AI provider and the development database. No real AI provider, WhatsApp, SMS, email, payment, ticketing or payout was contacted. Nothing was deployed.

The layer adds controlled AI "agents" on top of the existing ERP. An agent is **not** a new administrator and has **no authority of its own**: it acts for one signed-in person, can do only what that person may do, reaches the system only through a short list of vetted *tools*, and anything that moves money, issues or cancels tickets, or changes accounting/bank details needs a human — in code, at every autonomy level.

## 1. What already existed, and how it was reused

| Existing | Used for |
|---|---|
| Phase 13 AI abstraction (`AiProviderPort`, router, mock, OpenAI-compatible) | Model access, failover. Extended: the mock now speaks the agent protocol and can simulate outages, timeouts and malformed output |
| Phase 13 analytics registry (`AiAnalyticsService`) | The *only* way an agent gets management numbers (8 approved queries; no free-form SQL exists) |
| Approval engine (`ApprovalsService`) | Every AI approval request is mirrored into it (thresholds, multiple approvers, self-approval prevention) |
| Workflow event bus + engine (Phase 21) | Agents react to the 6 domain events that exist; a new `ai.scan` workflow action; the unavailable events stay marked unavailable |
| Flights, hotels, payments, wallet, CRM tasks, notifications, support, currency, visa checklist, Hajj/Umrah readiness | Tools call these services; no business logic was duplicated |
| WhatsApp module (consent, OTP verification, conversations, human takeover) | AI on WhatsApp is a small port; existing consent, verification and takeover rules gate it |
| Security module (Phase 22) | Safety events open incidents; step-up on lifting switches/publishing versions; privacy erasure deletes AI data |
| Audit log, RBAC, tenancy, `TenantScoped` | Every endpoint and tool is tenant-scoped; new `ai:*` permissions |

New data (migrations `20261011010000`, `20261011020000`): agents and versions, executions and steps, idempotent action records, approvals, memory, knowledge, feedback, controls (kill switch), budgets, conversations, recommendations (exception queue), safety events, briefings.

## 2. How a run works

```
person → API (authenticated, tenant-scoped) → AgentRunner
  1  kill switches, agent status, channel flags, tenant/agent budget      (before anything else)
  2  refuse blatant injection / secret / tenant-escape / bypass requests  (the model is never asked)
  3  loop: model proposes ONE JSON action: tool | final | delegate | handoff
       tool     → policy (risk × autonomy × the person's own permissions) → validate input
                → ALLOW: run once (idempotent) | REQUIRE_APPROVAL: record + wait | DENY: log
       final    → numbers checked against tool results, facts filled in by the runtime, sources attached
  4  limits at every step: steps, tool calls, time, delegation depth, repeats, tokens, cost
  5  record execution + steps (masked), audit every state-changing action with agent/version/prompt/model
```

The model never touches the database, never sees secrets (masked), and its text is never trusted: **permissions, tenant and branch scope, approvals and budgets are enforced in code around it.**

## 3. Agents (16, versioned)

Customer Service (conversational assistant, booking, payments, WhatsApp) · Staff Copilot · Sales · Flight Operations · Hotel Operations · Visa Operations · Hajj Operations · Umrah Operations · Group Operations · Finance Assistant (incl. reconciliation) · CRM (follow-up, customer journey) · Supplier · B2B/Corporate · Executive Intelligence · Security · Operations Supervisor.

Each has an id/key, audience, system prompt + prompt version, tool list, prohibited actions, autonomy level, model/provider + fallback, temperature, token/step/tool/time/depth limits, per-run budget, approval requirements, escalation policy and audit setting. **Changing any of it means publishing a new version** (previous version retired, kept, rollback possible); executions record the agent version and prompt version. Publishing/rollback is platform-administrator only and needs step-up.

## 4. Tools and risk (33 tools: 17 read-only, 5 low-risk write, 3 medium, 8 high)

* **READ_ONLY** — customer profile, bookings, booking detail, balance, payment status, visa applications (+checklist), pilgrim readiness, flight search, offer revalidation, hotel availability, knowledge search, analytics metric, supplier status, pending approvals, operational summary, leads needing follow-up, currency conversion.
* **LOW_RISK_WRITE** — create task, create CRM follow-up, create support ticket, record a recommendation, remember an approved preference.
* **MEDIUM_RISK** — create payment link (customer's own invoice), prepare flight booking (customer's explicit confirmation, revalidated price, no ticket), send notification (staff, under communication policy).
* **HIGH_RISK (always a human, 8)** — three run **under the approver's identity**, once, after approval: cancel a reservation, request a refund, issue a ticket. Five are **proposal-only**: adjust wallet balance, execute staff payout, mark payment verified, post journal entry, change bank details. Approving one of these records the decision; the AI cannot carry it out and a person does it in the normal screen (which has its own step-up, locking and idempotency). All five are also in every agent's prohibited list, so only an agent that is explicitly given the proposal tool can even suggest them.

Every tool validates input (unknown fields rejected), is scoped to the person's company (and branch where branch-limited; customers to their own record), filters its output (no hashes, secrets, bank numbers; passport numbers reduced to their last characters) and is audited.

## 5. Autonomy and approvals

Levels 0–5 as specified; the effective level is the lowest of the agent's, the platform ceiling, the company ceiling (and "autonomous execution off" caps it at 2). **There is no unrestricted level 5: HIGH_RISK tools need approval at every level.** An approval stores the agent, tool, resource, reason, parameters, a preview (what will happen, risks, financial/customer impact, who must approve), initiator, decision, approver and result. Approvers must hold the engine's decide permission *and* the action's own permission, cannot be the initiator, and the action runs once (atomic claim). Approve, reject, edit (re-validated) and cancel are supported.

## 6. Security boundaries (summary)

Prompt-injection, role-escalation, financial-bypass, secret and tenant-escape attempts (English, Hausa, Arabic phrasing) are refused before the model and recorded as safety events (high severity opens one de-duplicated Phase 22 incident per kind per day). External content (customer text, email, documents, provider responses) is wrapped as untrusted data and can add no tool, permission or approval. Sensitive text (cards by Luhn, tokens, keys, passwords) is masked before it reaches a model or a stored trace. Answers are built from **facts**: money is formatted by the runtime from the record's amount and currency; a number the model writes that no tool or user message supports is removed and logged (and a customer-facing run then hands over to a person). Sources shown come only from tools that actually ran. Currency conversion uses the company rate table and states original, converted, rate and rate date.

## 7. Memory, knowledge, privacy

Memory is tenant-scoped and limited to allow-listed keys per type (short-term conversation state; operational booking context; approved customer preferences; historical summaries), each with an expiry, size limit and masking; customers can view and delete theirs, and **erasing a customer deletes their AI conversations, memory and the text in traces and feedback**. Preferences stop when a customer switches personalisation off. Business knowledge is versioned with effective dates, company/branch/platform scope and citation labels; nothing matching → the agent says so and hands over. Feedback (correct / incorrect / partial / unsafe / needs review) is stored and measured; **nothing is used to train a model.**

## 8. Governance and cost control

AI Control Center (`/admin/ai`): dashboard, agents & versions, tool/permission matrix, providers (region, data sharing and retention are *declared* by an administrator, never assumed), executions with every step, approvals with action preview, budgets, feedback and quality components, safety incidents, knowledge, kill switch & policies, memory, audit. Controls exist at platform and company scope and **a company can only make things stricter**. Kill switch: disable all AI, one agent, one tool, autonomous execution; force approval; autonomy ceiling; per-channel flags. Turning protection on is instant; lifting needs step-up; every change is audited with a reason. Budgets: tokens/requests/cost per day or month, per tenant and per agent (platform limit caps company limits), checked before a run; each run also has its own token and cost cap.

## 9. Operations features

Exception queue and **Control Tower** (deterministic scanners: visa documents/stalls, Hajj/Umrah group readiness with an explained percentage, overdue balances, expiring passports, quiet leads, unresolved tickets, stale/duplicate/unmatched payments, expiring supplier contracts, provider failures, security spikes, failed automations, expiring flight holds, cross-sell) with a transparent priority score (deadline, customers, money, regulatory, dependency, risk); idempotent, so a daily run never duplicates work. Daily executive briefing (every figure shows its source). Customer assistant UI (EN/HA/AR, RTL, AI disclosure, sources, confidence, feedback, talk-to-a-person), Staff Copilot with dry-run, document / email / call assistants that **only propose** (passport MRZ with check digits; email draft never sent; a caller's spoken identity never verifies them), AI on WhatsApp (off by default; verified, opted-in customers only; staff takeover wins).

## 10. Verification

| Check | Command | Result when written |
|---|---|---|
| Unit/spec (agents) | `npx jest src/modules/agents` | 117 tests |
| Live end-to-end, red-team, isolation, kill switch, budgets, provider failure, versions | `node apps/api/scripts/ai/ai-agents-check.mjs` | 106 checks |
| Load and duplicate prevention | `node apps/api/scripts/ai/ai-perf-check.mjs` | 9 checks (mock provider, this machine) |

## 11. Known limitations (honest)

* The mock provider is a **rule-based planner, not a language model**. It proves the runtime, policies and integrations; it says nothing about how a real model would phrase answers or behave. No real provider was tested.
* Intent coverage of the mock is limited to the scenarios in the live suite; unknown requests hand over to a person.
* Source labels in answers are in English; answer text is localised for the main intents only.
* Speech-to-text, telephony and OCR are not implemented: the call assistant takes a transcript, the document assistant takes text.
* Event reactions exist for the six events the Phase 21 bus actually publishes.
* Branch scoping for AI follows each customer's assigned branch; company-wide roles see their whole company (platform-wide branch isolation outside AI is still S-37 in the security baseline).
* Performance figures are from one development machine with the mock provider; real provider latency, cost and rate limits are unmeasured.
* No external security assessment of the agent layer has been done.
