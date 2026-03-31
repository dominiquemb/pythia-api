#!/usr/bin/env bash
set -euo pipefail

# Database Backup Script for astrology-api
# Creates dump for pythia database and commits it to this repository

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKIP_GIT_PUSH=0
DATE_SUFFIX="${DATE_SUFFIX:-$(date +%Y%m%d)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-git-push)
      SKIP_GIT_PUSH=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Database credentials
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-m3tr4p1}"

# Temporary directory for dumps
TEMP_DIR="${TMPDIR:-/tmp}"

# Database and repository configuration
DB_NAME="pythia"
REPO_PATH="$PROJECT_ROOT"
DUMP_BASENAME="${DB_NAME}-dump-${DATE_SUFFIX}.sql"
DUMP_DEST_PATH="${REPO_PATH}/dumps/${DUMP_BASENAME}"
DUMP_TEMP_PATH="$(mktemp "${TEMP_DIR}/${DB_NAME}-dump-XXXXXX.sql")"

cleanup() {
    rm -f "$DUMP_TEMP_PATH"
}

trap cleanup EXIT

echo "========================================="
echo "Database Backup Script - pythia"
echo "Date: $(date)"
echo "========================================="

# Create database dump
echo ""
echo "[1/3] Creating database dump..."

echo "  Dumping ${DB_NAME} database..."
MYSQL_PWD="$DB_PASSWORD" mysqldump -h "$DB_HOST" -u "$DB_USER" \
    --databases "$DB_NAME" \
    --result-file="$DUMP_TEMP_PATH" \
    --single-transaction \
    --quick \
    --lock-tables=false

if [[ -f "$DUMP_TEMP_PATH" ]]; then
    size=$(du -h "$DUMP_TEMP_PATH" | cut -f1)
    echo "    ✓ Created ${DB_NAME} dump (${size})"
else
    echo "    ✗ Failed to create ${DB_NAME} dump"
    exit 1
fi

# Commit dump to repository
echo ""
echo "[2/3] Committing dump to repository..."

# Create dumps directory if it doesn't exist
mkdir -p "${REPO_PATH}/dumps"

# Copy dump file
cp "$DUMP_TEMP_PATH" "$DUMP_DEST_PATH"

# Commit to git
cd "$REPO_PATH"

# Check if there are changes to commit
if ! git diff --quiet -- "dumps/${DUMP_BASENAME}" || [[ -n "$(git ls-files --others --exclude-standard -- "dumps/${DUMP_BASENAME}")" ]]; then
    git add "dumps/${DUMP_BASENAME}"
    git commit -m "Add database dump for ${DB_NAME} - ${DATE_SUFFIX}"

    echo "  ✓ Committed ${DUMP_BASENAME}"

    if [[ "$SKIP_GIT_PUSH" -eq 1 ]]; then
        echo "  - Skipping push (--skip-git-push)"
    else
        echo "  Pushing to remote..."
        if git push; then
            echo "    ✓ Pushed successfully"
        else
            echo "    ✗ Push failed"
        fi
    fi
else
    echo "  - No changes (${DUMP_BASENAME} already matches the current database state)"
fi

echo ""
echo "[3/3] Cleaning up temporary files..."
echo "  ✓ Temporary files removed"

echo ""
echo "========================================="
echo "Backup complete!"
echo "========================================="
