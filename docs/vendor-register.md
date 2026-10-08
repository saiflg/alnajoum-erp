# Vendor and third-party register (Phase 22)

Every external party the platform can send data to or depend on. "Status" is what this repository does **today**: the platform ships with **mock providers for everything**, so until an operator configures a real one under Admin → Integrations, nothing below receives any data.

Data-sharing and contractual columns are for the operator to complete: they depend on the contracts the business signs, which the software cannot know. Nothing in this table is legal advice.

| Vendor / service | Purpose | Data sent | Status in this repo | Credential storage | Failure impact | Operator to confirm |
|---|---|---|---|---|---|---|
| **Paystack** | Card/bank online payments, webhooks | Customer email, amount, currency, invoice reference. No card numbers touch the platform (hosted checkout) | Integration written, **mock by default**; production boot refuses the mock | Encrypted in `integration_credentials` (Super Admin only, step-up) | Online payment unavailable; manual payments still work | Contract/DPA, settlement account, webhook secret rotation, PCI scope (hosted checkout keeps card data off the platform) |
| **OPay** | Alternative online payments | As above | Integration written, mock by default | Encrypted | As above | As above |
| **Meta WhatsApp Cloud API** | Customer messaging, OTP, payment links | Customer phone numbers, message text, document links | Integration written, mock by default; webhooks verified by HMAC | Encrypted | WhatsApp channel degrades; staff act manually | Meta business verification, template approval, consent records, data-processing terms |
| **SMTP provider** | Transactional email (reset links, receipts, notifications) | Recipient email, message content (reset links are single-use, 30 min) | Integration written, mock/log by default | Encrypted | Email undelivered; reset links must be re-requested | Provider DPA, SPF/DKIM/DMARC on the sending domain |
| **Duffel / Sabre / Amadeus / Travelport / TBO** | Flight search and ticketing | Search criteria; for bookings, passenger names, passport data, contact details | Adapters written, **mock by default** | Encrypted | Search/booking falls back to manual booking | Supplier contract, passenger-data terms, ticketing credentials, quota/billing |
| **Hotel suppliers** | Hotel availability and booking | Guest names, dates, contact | Mock supplier by default | Encrypted | Manual hotel booking | Supplier contract |
| **OpenAI-compatible LLM provider** | AI assistant / analytics narration | Whatever the feature sends; **should be configured never to receive raw passport or payment data** | Mock by default; outbound URL checked for private addresses | Encrypted | AI features unavailable | Provider data-retention/training terms, region, redaction policy (see Phase 23 governance) |
| **Staff payout provider** | Incentive payouts to staff bank accounts | Staff name, bank, account number, amount | **Mock only** — no real provider is integrated | n/a | Payouts cannot execute (they never silently succeed) | Choose a provider; account-verification process (already enforced in app) |
| **Oracle Cloud (hosting)** | Server, network, object storage | Everything (it hosts the database) | Deployment scripts exist; **nothing deployed** | Cloud account credentials are outside the platform | Total outage | Region, backup destination, access control on the cloud account, MFA |
| **Caddy / Let's Encrypt** | TLS termination and certificates | Domain name, traffic | In `docker-compose.prod.yml` | n/a | HTTPS unavailable | Domain ownership, renewal monitoring |
| **Docker Hub / npm registry** | Base images and packages at build time | none | Used at build | n/a | Cannot rebuild | Pin image digests; review the SBOM (`docs/sbom.cdx.json`) |
| **GitHub** | Source hosting | Source code | Remote `origin` | Developer credentials | Cannot deploy new code | Branch protection, 2FA, secret scanning |

## Review routine
* When a vendor is added: add a row *before* enabling it, record what data it receives, and get the contract/DPA reviewed.
* Quarterly: re-read this table against Admin → Integrations (active providers) and against the SBOM.
* On a vendor breach notice: open an incident (Admin → Security), rotate that vendor's credential (security.md §3.3), assess what data it held.

## Dependencies with known advisories
At the time of writing, `pnpm audit --prod` reports **one** high advisory: `deepmerge-ts` inside Prisma's own CLI configuration loader (`@prisma/config`), used when running Prisma commands and not on the request path of the running API. Development-only tooling carries further advisories. Both are tracked in the baseline (S-26) and should be re-checked with every dependency update.
