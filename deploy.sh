#!/usr/bin/env bash
set -euo pipefail

echo "======================================"
echo "Astrology API Deployment"
echo "======================================"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

echo "Pulling latest code from origin/main before deploy..."
git pull --ff-only origin main

echo "Installing dependencies..."
npm install

echo "Running database migrations..."
migration_output="$(npm run migrate -- --report-applied-count)"
echo "$migration_output"

applied_migrations="$(printf '%s\n' "$migration_output" | sed -n 's/^APPLIED_MIGRATIONS_COUNT=//p' | tail -n 1)"

if [[ -z "$applied_migrations" ]]; then
  echo "Unable to determine how many migrations were applied." >&2
  exit 1
fi

if (( applied_migrations > 0 )); then
  echo "Detected ${applied_migrations} new migration(s); creating and pushing a fresh database dump..."
  bash scripts/backup-database.sh
fi

echo "Restarting PM2 process (name: astrology-api)..."
pm2 restart astrology-api

echo "Deployment complete! Current PM2 status:"
pm2 list

echo "======================================"
echo "Deployment successful!"
echo "======================================"
