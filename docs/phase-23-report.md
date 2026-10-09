# Phase 23 report — Enterprise AI agentic travel operations

**LOCALHOST / TEST ONLY.** Everything ran against the built-in *mock* AI provider and development databases. No real AI provider, WhatsApp, SMS, email, payment, ticketing or payout was contacted. Nothing was deployed. The mock provider is a rule-based planner, not a language model: it proves the runtime, the policies and the integrations, and says nothing about how a real model would behave.

Full architecture, tool tables, governance and limitations: [ai-agents.md](ai-agents.md).

## 1. System audit

What already existed and was **reused rather than rebuilt**: the Phase 13 provider abstraction and analytics query registry (the only way an agent obtains management numbers), the approval engine, the workflow event bus and engine, the flight / hotel / payment / wallet / CRM / support / currency / visa / Hajj-Umrah services, the WhatsApp module with its consent, verification and human-takeover rules, the Phase 22 security module (incidents, step-up, privacy erasure), the audit log, RBAC and tenancy. Gaps found: no agent runtime, no tool permission layer, no AI-specific approval, no memory or knowledge store, no AI controls or budgets, no safety-event trail.

## 2. AI architecture

An agent has **no authority of its own**. It acts for one signed-in person, can do only what that person may do, and reaches the system only through registered *tools*. Each run: controls and budget are checked first → blatant injection / secret / tenant-escape / bypass requests are refused before the model → the model proposes **one** JSON action (tool, final answer, delegate, hand-off) → an in-code policy engine decides (risk × autonomy × the person's own permissions) → input is validated → the tool runs once (claim-before-act idempotency) → output is filtered and masked → steps are recorded in one insert. Loop protection: max steps, tool calls, time, delegation depth, repeats, ping-pong. Answers use `{{tool.field}}` placeholders filled by the runtime; a number the model invents is removed.

## 3. Agents (16, versioned)

Customer Service, Staff Copilot, Sales, Flight Operations, Hotel Operations, Visa Operations, Hajj Operations, Umrah Operations, Group Operations, Finance Assistant, CRM, Supplier, B2B/Corporate, Executive Intelligence, Security, Operations Supervisor. Every change is a new immutable version (rollback supported); executions record agent and prompt version. Publishing is Super Admin only and needs step-up.

## 4. Tools and risk levels (33)

| Risk | Count | Tools |
|---|---|---|
| READ_ONLY | 17 | getCustomerProfile, getMyBookings, getBooking, getCustomerBalance, getPaymentStatus, getVisaApplications, getPilgrimReadiness, searchFlights, revalidateFlightOffer, getHotelAvailability, searchKnowledge, getAnalyticsMetric, getSupplierStatus, getPendingApprovals, getOperationalSummary, getLeadsNeedingFollowUp, convertAmount |
| LOW_RISK_WRITE | 5 | createTask, createCRMFollowUp, createSupportTicket, createRecommendation, rememberPreference |
| MEDIUM_RISK | 3 | createPaymentLink, prepareFlightBooking (no ticket), sendNotification (communication policy) |
| HIGH_RISK — runs after human approval, under the approver's identity, once | 3 | cancelFlightBooking, requestFlightRefund, issueFlightTicket |
| HIGH_RISK — proposal-only; the AI can never execute | 5 | adjustWalletBalance, executeStaffPayout, markPaymentVerified, postJournalEntry, changeBankDetails |

## 5. Approvals

HIGH_RISK needs a human at **every** autonomy level; level 5 is not unrestricted. Each AI approval is mirrored into the existing approval engine (type `AI_ACTION`) with agent, tool, parameters, preview (what happens, risks, financial and customer impact, who must approve), initiator and result. The approver must hold the approval permission *and* the action's own permission, cannot be the initiator, and the approved action executes exactly once (atomic claim). Approve, reject, edit (re-validated) and cancel are supported.

## 6. Security

Refusals before the model for override / role-escalation / financial-bypass / secret / tenant-escape attempts in English, Hausa and Arabic, recorded as safety events (one de-duplicated incident per kind per day for high severity). External content is wrapped as untrusted data and can add no tool, permission or approval. Cards (Luhn), tokens, keys and passwords are masked before a model or a stored trace sees them. Tool output is filtered (no hashes, secrets or bank numbers; identity numbers reduced to their last characters). Tenant and customer scope are enforced in every tool.

## 7. AI memory

Tenant-scoped, allow-listed keys per memory type, with expiry, size limit and masking. Customers can view and delete theirs; erasing a customer deletes their AI conversations, memory and trace text; personalisation off stops use of preferences. Business knowledge is versioned with effective dates and company / branch / platform scope. Nothing is used to train a model.

## 8. AI governance

AI Control Center (`/admin/ai`, 13 tabs): dashboard, agents and versions, tool matrix, providers (data-sharing and retention declared by an administrator, never assumed), executions with every step, approvals, budgets, feedback and quality, safety incidents, knowledge, kill switch and policies, memory, audit. Kill switch at platform and company level (all AI, one agent, one tool, autonomous execution, force approval, autonomy ceiling, per-channel flags); a company can only be stricter than the platform; turning protection on is instant, lifting it needs step-up; every change is audited with a reason.

## 9. Cost control

Token / request / cost budgets per day or month, per tenant and per agent (platform caps company), checked before a run; per-run token and cost caps; model client with retry, timeout and a deterministic fallback that still goes through the same policy and approvals. Idempotent scanners and a daily briefing mean repeated runs create no duplicate work.

## 10. Test results

| Check | Result |
|---|---|
| Agents module unit/spec tests | pass (counts in the Phase 24 certification) |
| Live end-to-end, red-team, isolation, kill switch, budgets, provider failure, versions (`scripts/ai/ai-agents-check.mjs`) | **106 / 106** on the dev database and again on a database built from scratch |
| Load and duplicate prevention (`scripts/ai/ai-perf-check.mjs`) | **9 / 9** (40 concurrent conversations p95 1.76 s; 20 simultaneous identical requests → 1 task; 15 simultaneous payment-link requests → 1 attempt) |
| Cross-tenant replay including `/ai/*` (656 routes) | Only the documented shared-catalog hits and platform agent definitions |
| Regression (unit, e2e, security, concurrency, lint, builds) | see Phase 24 certification |

## 11. Known limitations

No real language model was tested; the mock's intent coverage is limited to the scenarios in the live suite and unknown requests hand over to a person. Source labels are English; answer text is localised for the main intents. No speech-to-text, telephony or OCR (the call assistant takes a transcript, the document assistant takes text). WhatsApp AI is unit-wired and gated by a feature flag but was not exercised end to end. Event reactions exist for the six events the Phase 21 bus publishes. Branch scoping follows each customer's assigned branch (S-37 outside AI). Performance figures are from one development laptop with the mock provider. No external security assessment of the agent layer.

**LOCALHOST / TEST ONLY.**
