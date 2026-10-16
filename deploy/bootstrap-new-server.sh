#!/usr/bin/env bash
# One-shot setup for a FRESH Ubuntu 24.04 VM (e.g. a new Oracle Always Free
# Ampere A1 instance). Automates DEPLOYMENT.md Parts 3-4: install Docker,
# open the local firewall for 80/443, clone the repo, generate .env.prod
# with fresh random secrets, then build, migrate, seed and start the stack.
#
# Run ON THE NEW SERVER as the default `ubuntu` user:
#   bash bootstrap-new-server.sh
#
# Optional environment variables:
#   REPO_URL      git URL to clone   (default https://github.com/saiflg/alnajoum-erp.git)
#   GITHUB_TOKEN  read-only token, only needed if the repo is private
#   DOMAIN        e.g. alnajoumtravelagency.com — if set, Caddy serves HTTPS for
#                 it (its DNS A record must already point at this server);
#                 if unset, the app is served over plain HTTP on the public IP
#
# Safe to re-run: it never overwrites an existing .env.prod, and every other
# step is idempotent.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/saiflg/alnajoum-erp.git}"
APP_DIR="$HOME/alnajoum-erp"

echo "==> Installing Docker, Git and firewall persistence"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git iptables-persistent openssl
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo usermod -aG docker "$USER"

echo "==> Opening ports 80/443 in the OS firewall (Oracle images block them by default; harmless elsewhere)"
for port in 80 443; do
  if ! sudo iptables -C INPUT -m state --state NEW -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "==> Getting the code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    CLONE_URL="${REPO_URL/https:\/\//https://x-access-token:${GITHUB_TOKEN}@}"
  else
    CLONE_URL="$REPO_URL"
  fi
  git clone "$CLONE_URL" "$APP_DIR"
  # Don't leave the token sitting in .git/config.
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
fi
cd "$APP_DIR"

if [ ! -f .env.prod ]; then
  echo "==> Generating .env.prod with fresh secrets"
  PUBLIC_IP="$(curl -fsS https://ifconfig.me || true)"
  if [ -n "${DOMAIN:-}" ]; then
    PUBLIC_ORIGIN="https://$DOMAIN"
    SITE_ADDRESS="$DOMAIN"
  else
    PUBLIC_ORIGIN="http://${PUBLIC_IP:?could not detect the public IP — set DOMAIN or fix outbound networking}"
    SITE_ADDRESS=":80"
  fi
  cp .env.prod.example .env.prod
  sed -i \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=$PUBLIC_ORIGIN|" \
    -e "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$SITE_ADDRESS|" \
    -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -hex 48)|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 48)|"     -e "s|^DATA_ENCRYPTION_KEYS=.*|DATA_ENCRYPTION_KEYS=$(date +%Y)a:$(openssl rand -base64 32)|"     -e "s|^BOOTSTRAP_ADMIN_EMAIL=.*|BOOTSTRAP_ADMIN_EMAIL=${ADMIN_EMAIL:?set ADMIN_EMAIL to the real administrator address}|"     -e "s|^BOOTSTRAP_ADMIN_PASSWORD=.*|BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -base64 18 | tr '/+' '_-')|" \
    .env.prod
  chmod 600 .env.prod
else
  echo "==> .env.prod already exists — leaving it untouched"
fi

# `sudo docker` throughout: the docker group membership added above only
# takes effect on the next login.
COMPOSE="sudo docker compose -f docker-compose.prod.yml --env-file .env.prod"

echo "==> Building images (first build takes several minutes)"
$COMPOSE build

echo "==> Starting database"
$COMPOSE up -d postgres

echo "==> Applying migrations and seeding permissions/roles/bootstrap admin"
$COMPOSE run --rm api npx prisma migrate deploy
$COMPOSE run --rm api npx prisma db seed

echo "==> Starting everything"
$COMPOSE up -d

echo
echo "==> Done. Container status:"
$COMPOSE ps
echo
echo "Open $(grep '^PUBLIC_ORIGIN=' .env.prod | cut -d= -f2-) and sign in as $(grep '^BOOTSTRAP_ADMIN_EMAIL=' .env.prod | cut -d= -f2-)."
echo "The one-time password is BOOTSTRAP_ADMIN_PASSWORD in .env.prod (chmod 600, never printed here)."
echo "Change it after first login. Also set PAYMENT_PROVIDER credentials in .env.prod: the API will not start"
echo "in production on the mock payment provider."
echo "Back up DATA_ENCRYPTION_KEYS from .env.prod somewhere off this server."
