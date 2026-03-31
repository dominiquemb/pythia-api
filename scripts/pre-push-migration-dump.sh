#!/usr/bin/env bash
set -euo pipefail

if [[ "${SKIP_MIGRATION_DUMP_PUSH_HOOK:-0}" == "1" ]]; then
  exit 0
fi

REMOTE_NAME="${1:-origin}"
upstream_ref="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"

if [[ -z "$upstream_ref" ]]; then
  echo "No upstream branch configured; skipping migration dump automation."
  exit 0
fi

if git diff --quiet "$upstream_ref...HEAD" -- 'scripts/[0-9][0-9][0-9]_*.sql'; then
  exit 0
fi

echo "Detected migration changes in commits being pushed."
migration_output="$(npm run migrate -- --report-applied-count)"
echo "$migration_output"

applied_migrations="$(printf '%s\n' "$migration_output" | sed -n 's/^APPLIED_MIGRATIONS_COUNT=//p' | tail -n 1)"

if [[ -z "$applied_migrations" ]]; then
  echo "Unable to determine how many migrations were applied during pre-push." >&2
  exit 1
fi

if (( applied_migrations == 0 )); then
  echo "No new migrations were applied locally; skipping automatic dump creation."
  exit 0
fi

previous_head="$(git rev-parse HEAD)"
bash scripts/backup-database.sh --skip-git-push
current_head="$(git rev-parse HEAD)"

if [[ "$current_head" == "$previous_head" ]]; then
  echo "No dump commit was created; continuing with the original push."
  exit 0
fi

echo "Pushing updated branch with the fresh dump commit..."
SKIP_MIGRATION_DUMP_PUSH_HOOK=1 git push --no-verify "$REMOTE_NAME" HEAD
echo "Fresh dump commit pushed. Stopping the original push because the branch advanced during the hook."
exit 1
