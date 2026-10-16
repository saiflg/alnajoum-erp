# Deploying to AWS (alnajoumtravelagency.com)

Status: **DEPLOYED 2026-10-16** (VERIFIED: HTTPS answers on https://alnajoumtravelagency.com, API health `ok`, server commit equals
local commit, new code present in the running container). One `t3.small` (2 GB, Ubuntu 24.04, 30 GB) in **eu-north-1
(Stockholm)** with an Elastic IP, running the five containers from `docker-compose.prod.yml`. Created through the EC2 console;
the server was then set up over SSH with `deploy/bootstrap-new-server.sh`.

Lessons from the first real run (all fixed in the repository):

* **Region.** Some AWS organisations deny every region except one (eu-north-1 here). If EC2 says "explicit deny", check the region first.
* **Memory.** Building on 2 GB needs a 6 GB swap file and a raised Node heap (`NODE_OPTIONS=--max-old-space-size=3072`, now in the
  Dockerfiles and the seed step). Build one image at a time (`COMPOSE_PARALLEL_LIMIT=1`). `t3.micro` (1 GB) is too small.
* **Firewall step.** The bootstrap script's iptables rule was written for Oracle images and failed on plain Ubuntu; fixed.
* **Fixed IP.** Allocate an Elastic IP before pointing DNS; a stop/start changes the public address otherwise.
* **HTTPS.** Start with the IP over HTTP, point DNS (Cloudflare **DNS only**), then set `PUBLIC_ORIGIN=https://<domain>` and
  `SITE_ADDRESS=<domain>` in `.env.prod` and rebuild the web image (the address is baked in at build time).

Still to do on this server: real `PAYSTACK_SECRET_KEY`, SMTP settings (mail is `mock`, nothing is sent), WhatsApp credentials,
back up `DATA_ENCRYPTION_KEYS` off the server, change the bootstrap administrator password and remove it from `.env.prod`,
automatic backups of the database volume, and an AWS budget alert.

## Original plan (kept for reference)

## Before you start: lift the organisation block

The deny comes from the organisation's management account (`336757183545`, owner email `muhasaif1@gmail.com`), policy
`p-xa9xy0in`. Only that account can change it. Either:

1. sign in to the management account, open **AWS Organizations, Policies, Service control policies**, and edit
   `p-xa9xy0in` so it no longer denies `ec2:*` (and, optionally, remove the region restriction); **or**
2. move account 494166749014 to an organisational unit that the policy is not attached to; **or**
3. use a standalone AWS account that is not in an organisation.

Check with: `aws ec2 describe-vpcs --profile alnajoum --region eu-west-1` - it must return a list instead of
"explicit deny in a service control policy".

## One-command launch

```bash
AWS_PROFILE=alnajoum DOMAIN=alnajoumtravelagency.com ADMIN_EMAIL=<your admin email> bash deploy/aws-launch.sh
```

It first prints what it would create and the monthly cost and does nothing else. Re-run with `CONFIRM=yes` to create:
a firewall (22/80/443), an SSH key (`~/.ssh/alnajoum-erp.pem`), one Ubuntu 24.04 `t3.small` (2 GB; `t3.micro` is
free-tier eligible but too small to build the images), a 30 GB disk and a fixed IP. On first boot the server adds swap
and runs `deploy/bootstrap-new-server.sh` (Docker, firewall, clone, `.env.prod` with fresh random secrets, build,
migrations from an empty database, seed, start).

## DNS at Cloudflare

Add an **A** record for `alnajoumtravelagency.com` (and `www`) pointing at the printed IP, with **Proxy status: DNS only**
(grey cloud). Caddy then obtains the HTTPS certificate by itself. Once it works you may switch the proxy on and set
Cloudflare SSL/TLS mode to **Full (strict)**.

## What production needs from you (cannot be generated)

* `PAYSTACK_SECRET_KEY` (or OPay keys) in `.env.prod` for real online payments. The API refuses the mock payment provider
  in production.
* WhatsApp: `WHATSAPP_PROVIDER` defaults to `meta`; add the Meta credentials at **/admin/integrations** when you have them.
  Until then WhatsApp sending fails honestly rather than pretending.
* Email: set `NOTIFICATION_PROVIDER=smtp` and the `SMTP_*` values (or the same at /admin/integrations). Until then no email
  leaves the server, including password resets and campaign confirmations. Publish SPF, DKIM and DMARC for the sending
  domain at Cloudflare; the system cannot check them for you.
* Back up `DATA_ENCRYPTION_KEYS` from `.env.prod` somewhere off the server. Without it encrypted fields cannot be read.
* Change the bootstrap administrator password at first login and delete `BOOTSTRAP_ADMIN_PASSWORD` from `.env.prod`.

## Updating later

`bash deploy/deploy.sh` (see the script's header) pulls the repository and rebuilds. Push first, then check the server's
`git log` shows the same commit.
