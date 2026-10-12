# Disaster recovery and business continuity

A backup is only worth what a *restore* of it is worth. This page says what is backed up, the targets, the procedures, and — separately and honestly — what has been **proved** versus what is **written but untested**.

## 1. What must survive

| Asset | Where it lives | Backed up by | Restore proved? |
|---|---|---|---|
| Database (every business record, audit log, ledger) | Postgres volume `postgres_data` | `deploy/backup.sh` (`pg_dump -Fc`, verified readable, SHA-256, optionally AES-256 encrypted) | **Yes** — restored into a scratch database and row counts compared (§5) |
| Customer documents (passports, receipts) | Docker volume `uploads_data` | `UPLOADS_VOLUME=… deploy/backup.sh` (tar archive) | **Yes** — archived and restored into a fresh volume with identical checksums (§5); restoring the real production volume was not rehearsed |
| **Encryption keys** (`DATA_ENCRYPTION_KEYS`) | `.env.prod` on the server | **Nothing automatic. You must copy them somewhere that is not the server.** | n/a |
| Other secrets (JWT, provider keys) | `.env.prod`; provider keys inside the database (encrypted) | Provider keys travel with the database backup; JWT secrets are in `.env.prod` | Provider keys: yes (they are database rows). JWT secrets: regenerate if lost (everyone signs in again) |
| Application code | Git | Git | n/a |

> **The most important sentence on this page:** an encrypted column (integration credentials, authenticator secrets, staff payout account numbers, passport numbers) restored without `DATA_ENCRYPTION_KEYS` is unreadable. Keep the keys with the same care as the database backups, but not in the same place.

## 2. Objectives

These are **targets to be met by a schedule you must actually run**, not guarantees the software provides.

| | Target | Basis |
|---|---|---|
| **RPO** (data you can lose) | ≤ 24 h with a daily backup; ≤ 1 h if you schedule hourly | Equals the backup interval. Nothing runs the backup for you until you schedule it (§3) |
| **RTO** (time to be working again) | ≤ 4 h for a rebuild on a new server | **Not measured end to end.** Only the database part is measured (§5): backup 14 s, verified restore 58 s on the ~0.6 MB local demo database. A production-sized database, DNS, certificates and a fresh server take longer; re-measure with real data volume before relying on this number |

## 3. Backup procedure

```bash
# Encrypted database dump (+ documents), kept 14 days locally
BACKUP_PASSPHRASE='…' UPLOADS_VOLUME=alnajoum-erp_uploads_data ./deploy/backup.sh

# Copy off the machine (requires rclone configured): the same command with
BACKUP_REMOTE=remote:bucket/alnajoum ./deploy/backup.sh
```

Schedule it (the script does not schedule itself), e.g. on the server:

```cron
15 2 * * *  cd /opt/alnajoum-erp && BACKUP_PASSPHRASE="$(cat /root/.backup-pass)" BACKUP_REMOTE=remote:bucket/alnajoum ./deploy/backup.sh >> /var/log/alnajoum-backup.log 2>&1
```

What the script guarantees: the dump is read back (`pg_restore --list`) before it is kept; a SHA-256 is written next to it; files are mode 0600; old files are pruned. What it does **not** do: run itself, copy off the machine unless `BACKUP_REMOTE` is set, or back up the encryption keys.

A backup on the same disk as the database does not protect against losing the disk. The off-machine copy is not optional.

## 4. Restore procedures

### 4.1 Verify a backup (safe, do this routinely)
```bash
BACKUP_PASSPHRASE='…' ./deploy/restore-check.sh backups/db-<timestamp>.dump.enc
```
Restores into a throw-away database, compares row counts of the key tables with the live database, prints the migration history of the copy, drops the scratch database. Run it after the first backup, after every schema change, and at least monthly.

### 4.2 Recover after data loss or corruption (replaces live data — manual, deliberate)
> Written from the verified pieces above; the *final step of replacing the live database has not been drilled in this environment.* Do a rehearsal on a spare server before you need it.

1. Decide the recovery point (which backup). Anything after it is lost (that is the RPO).
2. Put the application in maintenance: `docker compose -f docker-compose.prod.yml stop api web`.
3. Keep the damaged database: `docker exec alnajoum-postgres pg_dump -U alnajoum -Fc alnajoum_erp > damaged-$(date +%F).dump` (forensics, and a way back).
4. Decrypt if needed: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in db-….dump.enc -out db.dump -pass env:BACKUP_PASSPHRASE`.
5. Recreate the database and restore:
   ```bash
   docker exec -i alnajoum-postgres psql -U alnajoum -d postgres -c 'DROP DATABASE alnajoum_erp' -c 'CREATE DATABASE alnajoum_erp'
   docker exec -i alnajoum-postgres pg_restore -U alnajoum -d alnajoum_erp --no-owner --exit-on-error < db.dump
   ```
6. Confirm the right `DATA_ENCRYPTION_KEYS` are in `.env.prod` (the key id on the encrypted rows must be listed).
7. Start: `docker compose -f docker-compose.prod.yml up -d`. The API applies any newer migrations on start and re-encrypts anything under an old key.
8. Verify: sign in, open an invoice, open Admin → Security → Overview, and check `/api/v1/health`.
9. Restore documents from the archive into the `uploads_data` volume if they were lost.
10. Open an incident (Admin → Security) recording what happened, the recovery point and the data window lost.

### 4.3 Rebuild on a new server
Provision → `deploy/bootstrap-new-server.sh` → copy `.env.prod` (from your key custody, §1) → restore the database (§4.2 steps 4–5) → restore documents → point DNS → confirm TLS → verify (§4.2 step 8). Not rehearsed end to end.

## 5. Drill log

| Date | Drill | Result |
|---|---|---|
| 2026-10-08 | Encrypted backup of the local development database, then `restore-check.sh` | **PASSED.** Backup 14 s, 640 KB encrypted (`.dump.enc`), checksum OK. Restore into a scratch database + comparison 58 s. Row counts live = restored: identities 22, customers 13, invoices 109, payments 90, journal_entries 50, wallet_transactions 24, audit_logs 444, flight_bookings 97. Restored copy carried all 49 migrations (latest `20261010020000_phase22_campaign_creator_relation`) |
| 2026-10-09 | Phase 24 re-drill on the current schema: encrypted backup → `restore-check.sh` | **PASSED.** 51 migrations (latest `20261011020000_phase23_conversation_customer_fk`); identities, customers, invoices, payments, journal entries, wallet transactions, audit logs, flight bookings, **AI executions / agents / approvals** and **workflow executions** all equal to live. (Took 6 min only because Docker was compiling the images on the same 4 GB machine; the same restore took 55 s on an idle machine.) |
| 2026-10-09 | Backup integrity: checksum, encryption | **PASSED.** SHA-256 verified; the wrong passphrase is refused (openssl exit 1); the right one decrypts |
| 2026-10-09 | **Recovery rehearsal**: decrypt → restore into a brand-new database → boot the application against it → sign in → read data | **PASSED.** Restore 55 s; the API reached healthy; an existing customer signed in with their old password; their 19 invoices and the security console were readable. 100 s end to end for the demo-sized database. The restored copy had fewer rows than live only because the backup predates the later test runs |
| 2026-10-09 | Document (uploads) restore | **PASSED.** Archive created with the exact command in `backup.sh`, checksum verified, restored into a new empty volume: 5 files in nested folders, every SHA-256 identical (a drill volume, not the live uploads) |
| — | Full rebuild on a new server | **Not done** |
| — | Restore over the live database | **Not done** (the rehearsal above restores beside it, never over it) |

## 6. Failure scenarios

| Scenario | Impact | Response |
|---|---|---|
| API container crashes | Brief outage | Compose restarts it (`restart: unless-stopped`, healthcheck) |
| Database container crashes | Outage; data intact on the volume | Compose restarts it; if the volume is damaged → §4.2 |
| Disk or VM lost | Outage; **data lost back to the last off-machine backup** | §4.3 |
| Bad deploy / bad migration | Wrong behaviour or failed start | Redeploy the previous image; if a migration damaged data → §4.2 |
| Accidental deletion by a user | Records gone | Most records are soft-state or reversible (ledger entries are reversed, never deleted); otherwise restore into a scratch database (§4.1 method) and copy the rows back |
| Ransomware / malicious admin | Possible data loss and disclosure | Contain (§3.2 of security.md), restore from an off-machine backup the attacker could not reach — which is why the copy must be somewhere the server's credentials cannot delete |
| Lost encryption keys | Encrypted columns unreadable | Restore the keys from custody. If truly lost: re-enter integration credentials, staff re-enrol two-factor and re-enter bank details; everything else is unaffected |
| Payment provider down | Online payments fail | Customers can pay by manual payment/bank transfer; pending intents reconcile when the provider returns |
| WhatsApp / SMTP / flight provider down | That channel degrades | Each integration is isolated; staff can act manually |

## 7. Business continuity

* **Manual fallback**: invoices, manual payments, bookings and the daily closing can all be recorded by staff without any external provider.
* **Contacts**: keep an off-system sheet (printed or in a password manager) with the hosting account, DNS registrar, payment provider and WhatsApp business contacts, and who may authorise a restore.
* **Roles**: at least two people hold Super Admin; at least two know where the encryption keys and backup passphrase are kept.
* **Review**: after any real incident and at least every six months, re-run §4.1, update the drill log, and re-measure the RTO with the current data size.

## 8. Gaps (not hidden)

No backup schedule is installed by default · no off-machine destination is configured by default · uploads restore, full rebuild and restore-over-live have not been rehearsed · no standby database or automatic failover (single Postgres) · RTO measured only for the database step on demo-sized data · container/compose hardening is written but not built here.
