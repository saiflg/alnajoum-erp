# Deploying to Oracle Cloud Free Tier

A step-by-step guide to running the whole Alnajoum Travel Agency platform —
Postgres, Redis, the API, the website, and a reverse proxy — on Oracle
Cloud's **Always Free** tier, for **$0/month**, permanently (not a trial).

Everything runs as Docker containers on one VM. You'll start on the server's
public IP with plain HTTP, confirm the whole app works, and add a domain +
HTTPS as a later, five-minute step — see [Part 6](#part-6-adding-a-domain--https).

## What you get on Always Free

- **1 Ampere A1 compute instance**: up to 4 OCPU / 24 GB RAM, running Ubuntu.
  This is enormously more than this app needs — Postgres, Redis, the API,
  and the website all fit comfortably with room to spare.
- **200 GB of block storage** (boot volume + one extra volume if you want
  it) — enough for the OS, Docker images, the database, and every uploaded
  document for a very long time.
- **10 TB/month of outbound data transfer** — far more than a travel
  agency's booking traffic will use.
- No credit card charge as long as you stay on Always Free resources (a
  card is required to create the account, for identity verification, but
  Always Free resources genuinely don't bill it).

## Before you start

You'll need:
- An email address and a phone number for Oracle Cloud account verification.
- About 45 minutes for the first deploy.
- This repository pushed somewhere you can `git clone` from the server —
  a private GitHub repo is the easiest (Oracle's VM will need either the
  repo to be public, or a deploy key / personal access token to clone a
  private one; instructions for both are in [Part 3](#part-3-get-the-code-onto-the-server)).

---

## Part 1: Create the Oracle Cloud account

1. Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) and
   click **Start for free**.
2. Fill in your email, verify it, then complete the signup form: name,
   address, phone (verified by SMS/call), and payment card (for identity
   verification only — see the note above).
3. Choose your **Home Region** carefully during signup — this cannot be
   changed later without opening a support ticket. Pick the region
   geographically closest to your customers (e.g. an EU or Middle East
   region tends to have lower latency to Nigeria than US regions; check
   [Oracle's region list](https://www.oracle.com/cloud/data-regions/) and
   pick whichever is closest).
4. Once your account is provisioned (a few minutes), sign in to the
   **OCI Console**.

## Part 2: Create the Ampere A1 VM

1. In the OCI Console, open the navigation menu → **Compute** → **Instances**
   → **Create instance**.
2. **Name**: `alnajoum-app` (or anything you like).
3. **Image and shape**:
   - Click **Edit** next to "Image and shape".
   - Image: **Canonical Ubuntu** → **24.04** (the current LTS; pick the newest
     `24.04.x` build offered — avoid a non-LTS release like 26.04 if it's also
     listed, since third-party apt repos such as Docker's sometimes lag behind
     a release that fresh).
   - Shape: click **Change shape**, select **Ampere** → **VM.Standard.A1.Flex**.
   - Set **4 OCPUs** and **24 GB memory** (the full Always Free allocation —
     using less doesn't save you anything, since it's free either way, up
     to those limits).
4. **Networking**: leave the defaults (a new VCN is created for you). Make
   sure **"Assign a public IPv4 address"** is checked — you need this to
   reach the server.
5. **Add SSH keys**: select **Generate a key pair for me**, then click
   **Save private key** and **Save public key**. Save the private key
   somewhere safe on your own computer (e.g. `~/.ssh/alnajoum-oracle.key`)
   — you cannot download it again later.
6. **Boot volume**: leave the default size (it comes out of your 200 GB
   Always Free allowance; the default is generous).
7. Click **Create**. The instance takes a minute or two to provision.
8. Once it shows **Running**, copy its **Public IP address** from the
   instance details page — you'll need it for every step below.

### Open ports 80 and 443

By default only SSH (port 22) is open. You need to open HTTP/HTTPS too:

1. On the instance's details page, click the link under **Primary VNIC** →
   **Subnet**, which opens the subnet's details.
2. Click the **Default Security List** for that subnet.
3. Click **Add Ingress Rules** and add two rules (repeat for each):
   - Source CIDR: `0.0.0.0/0`, IP Protocol: TCP, Destination Port: `80`
   - Source CIDR: `0.0.0.0/0`, IP Protocol: TCP, Destination Port: `443`
4. Save.

This opens the door at the *cloud network* level. Ubuntu's own firewall
(`iptables`, pre-configured by Oracle's image) also blocks these ports by
default — that's handled in Part 3 below, or Docker will simply not be
reachable even with the security list open.

## Part 3: Get the code onto the server

SSH into the instance (replace with your actual IP and key path):

```bash
ssh -i ~/.ssh/alnajoum-oracle.key ubuntu@<your-vm-public-ip>
```

Install Docker, Docker Compose, and Git, and open the local firewall for
80/443 (Oracle's Ubuntu image ships with `iptables` rules that block
everything but SSH out of the box):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Log out and back in once (`exit`, then SSH in again) so the `docker` group
membership takes effect without needing `sudo` for every Docker command.

Now get the code. **If your repo is public on GitHub:**

```bash
git clone https://github.com/<you>/alnajoum-erp.git ~/alnajoum-erp
```

**If it's private**, create a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
scoped to just this repo with read-only Contents access, then:

```bash
git clone https://<your-username>:<your-token>@github.com/<you>/alnajoum-erp.git ~/alnajoum-erp
```

(You haven't pushed this repo to GitHub yet if you've only been working
locally — do that first: create an empty repo on GitHub, then from your
own machine `git remote add origin <url>` and `git push -u origin master`.)

## Part 4: Configure and start the stack

```bash
cd ~/alnajoum-erp
cp .env.prod.example .env.prod
nano .env.prod
```

Fill in `.env.prod`:
- `POSTGRES_PASSWORD` — generate one: `openssl rand -hex 24`
- `PUBLIC_ORIGIN` — `http://<your-vm-public-ip>` for now (no domain yet)
- `SITE_ADDRESS` — leave as `:80` for now
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — generate each separately:
  `openssl rand -hex 48`
- Leave `NOTIFICATION_PROVIDER=mock` for now (emails get logged, not sent —
  see [Part 7](#part-7-turning-on-real-email) to switch it on later)

Save and exit (`Ctrl+O`, Enter, `Ctrl+X` in `nano`).

Now build and start everything:

```bash
chmod +x deploy/deploy.sh
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

The first build takes several minutes (compiling `argon2`/`sharp`'s native
bindings, plus the Next.js build). Watch progress with:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

Once `postgres` and `redis` report healthy, apply migrations and seed the
bootstrap data (company, roles, permissions, Super Admin account):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api npx prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api npx prisma db seed
```

### Verify it

Open `http://<your-vm-public-ip>` in a browser. You should see the
marketing homepage. Log in with the bootstrap Super Admin
(`admin@alnajoum.travel` / `Alnajoum@2026`) at `/login`, then **change that
password immediately** from `/portal/profile` (or wherever your logged-in
role lands) — it's a well-known default from this codebase's seed script,
not a secret.

If something doesn't load, check logs for the specific service:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs api
docker compose -f docker-compose.prod.yml --env-file .env.prod logs web
docker compose -f docker-compose.prod.yml --env-file .env.prod logs caddy
```

## Part 5: Deploying updates later

Whenever you push new commits, deploy them with the included script, run
from `~/alnajoum-erp` on the server:

```bash
./deploy/deploy.sh
```

This pulls the latest code, rebuilds only what changed, applies any new
Prisma migrations, and restarts the containers. It's safe to re-run.

## Part 6: Adding a domain + HTTPS

Once you own a domain (any registrar works — Namecheap, Cloudflare
Registrar, etc. — Oracle doesn't sell domains itself):

1. In your registrar's DNS settings, add an **A record**: host `@` (or
   `www`), value = your VM's public IP.
2. Wait for it to propagate (usually minutes, sometimes up to an hour) —
   check with `dig yourdomain.com` or [dnschecker.org](https://dnschecker.org).
3. On the server, edit `.env.prod`:
   ```
   PUBLIC_ORIGIN=https://yourdomain.com
   SITE_ADDRESS=yourdomain.com
   ```
4. Rebuild the web image (it bakes `PUBLIC_ORIGIN` into the client bundle
   at build time) and restart everything:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod build web
   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
   ```

That's it — Caddy (the reverse proxy) automatically requests and renews a
free Let's Encrypt certificate the moment it sees a real domain in
`SITE_ADDRESS`, and redirects HTTP to HTTPS. No certbot, no manual renewal.

## Part 7: Turning on real email

Right now `NOTIFICATION_PROVIDER=mock` — booking confirmations, receipts,
staff temp-passwords, and contact form messages are all logged, not
actually sent. To send real email:

1. Get SMTP credentials. Options that work well for a small Nigerian
   business:
   - **Gmail** (`alnajoumtravelagency@gmail.com`): create an
     [App Password](https://myaccount.google.com/apppasswords) (requires
     2-Step Verification enabled first) — regular Gmail passwords won't
     work with SMTP. Host: `smtp.gmail.com`, port `587`, secure `false`
     (STARTTLS).
   - **A transactional email provider** (Brevo, Mailgun, Amazon SES) —
     more reliable at scale and less likely to be marked as spam than
     sending directly from Gmail, worth switching to once volume grows.
2. In `.env.prod`, set:
   ```
   NOTIFICATION_PROVIDER=smtp
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=alnajoumtravelagency@gmail.com
   SMTP_PASSWORD=<the app password>
   SMTP_FROM=alnajoumtravelagency@gmail.com
   CONTACT_RECIPIENT_EMAIL=alnajoumtravelagency@gmail.com
   ```
3. Restart the API: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`
4. Test it: submit the contact form on the live site, then check the
   inbox — and check `/admin/notifications` in the app either way, since
   every attempt (sent or failed) is logged there with the actual error if
   one occurred.

## Part 8: Ongoing maintenance

- **Backups**: the database lives in the `postgres_data` Docker volume,
  which lives on the VM's persistent block storage — it survives reboots
  and `docker compose down`/`up`. For off-server backups (recommended —
  protects against the VM itself being lost), a simple cron job works:
  ```bash
  docker compose -f ~/alnajoum-erp/docker-compose.prod.yml --env-file ~/alnajoum-erp/.env.prod exec -T postgres \
    pg_dump -U alnajoum alnajoum_erp | gzip > ~/backups/alnajoum-$(date +%F).sql.gz
  ```
  Add that to `crontab -e` for a daily run, and periodically copy
  `~/backups` somewhere off the VM (Oracle's free Object Storage — 20 GB —
  is a natural place; `oci os object put` from the CLI, or just `scp` to
  your own machine).
- **Uploaded documents** (passports, IDs, visas) live in the `uploads_data`
  volume, same persistence guarantee as the database — no separate object
  storage migration is required for a single-VM deployment like this one.
  Revisit only if you later scale to multiple app instances.
- **Disk space**: `docker image prune -f` (already run by `deploy.sh`)
  keeps old image layers from accumulating.
- **OS updates**: `sudo apt-get update && sudo apt-get upgrade -y`
  periodically; reboot if the kernel was updated (`sudo reboot` — Docker
  containers restart automatically on boot since they're all
  `restart: unless-stopped`).

## Reference: what's actually running

| Container | What it does | Exposed to the internet? |
|---|---|---|
| `postgres` | Database | No — internal Docker network only |
| `redis` | Cache/session store | No — internal Docker network only |
| `api` | NestJS backend | No — only reachable through Caddy |
| `web` | Next.js frontend | No — only reachable through Caddy |
| `caddy` | Reverse proxy + TLS | Yes — ports 80/443 |

Caddy is the only thing with a port published to the host; everything else
talks over the internal `alnajoum-erp_internal` Docker network, so the
database and API are never directly reachable from outside the server —
see [`docker-compose.prod.yml`](docker-compose.prod.yml) and
[`deploy/Caddyfile`](deploy/Caddyfile) for the exact routing (`/api/*` to
the API, everything else to the website, both on one origin so the
existing cookie-based auth needs no cross-origin configuration).
