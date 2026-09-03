#!/usr/bin/env bash
# Run this ON THE ORACLE VM, from the repo root (~/alnajoum-erp), to deploy
# the latest code: git pull -> rebuild changed images -> run pending Prisma
# migrations -> restart with zero-downtime-ish rolling recreate. Safe to
# re-run; each step is idempotent.
#
# Usage: ./deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.prod ]; then
  echo "Missing .env.prod — copy .env.prod.example to .env.prod and fill it in first." >&2
  exit 1
fi

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Building images"
docker compose -f docker-compose.prod.yml --env-file .env.prod build

echo "==> Applying database migrations"
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  api npx prisma migrate deploy

echo "==> Seeding permission catalogue + role grants (idempotent, no demo data)"
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  api npx prisma db seed

echo "==> Restarting services"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo "==> Pruning old images"
docker image prune -f

echo "==> Done. Recent API logs:"
docker compose -f docker-compose.prod.yml --env-file .env.prod logs --tail=20 api
