#!/usr/bin/env bash
set -euo pipefail

# Database Backup Script for astrology-api
# Creates dump for pythia database and commits it to this repository

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Database credentials
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-admin}"
DB_PASSWORD="${DB_PASSWORD:-m3tr4p1}"

# Date for dump files
DATE_SUFFIX=$(date +%Y%m%d)

# Temporary directory for dumps
TEMP_DIR="/tmp"

# Database and repository configuration
DB_NAME="pythia"
REPO_PATH="$PROJECT_ROOT"

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
    --result-file="${TEMP_DIR}/${DB_NAME}-dump.sql" \
    --single-transaction \
    --quick \
    --lock-tables=false

if [[ -f "${TEMP_DIR}/${DB_NAME}-dump.sql" ]]; then
    size=$(du -h "${TEMP_DIR}/${DB_NAME}-dump.sql" | cut -f1)
    echo "    ✓ Created ${DB_NAME}-dump.sql (${size})"
else
    echo "    ✗ Failed to create ${DB_NAME} dump"
    exit 1
fi

# Commit dump to repository
echo ""
echo "[2/3] Committing dump to repository..."

dump_file="${TEMP_DIR}/${DB_NAME}-dump.sql"
dest_file="${REPO_PATH}/dumps/${DB_NAME}-dump-${DATE_SUFFIX}.sql"

# Create dumps directory if it doesn't exist
mkdir -p "${REPO_PATH}/dumps"

# Copy dump file
cp "$dump_file" "$dest_file"

# Commit to git
cd "$REPO_PATH"

# Check if there are changes to commit
if git status --porcelain dumps/ | grep -q "^??" || git status --porcelain dumps/ | grep -q "^M"; then
    git add "dumps/${DB_NAME}-dump-${DATE_SUFFIX}.sql"
    git commit -m "Add database dump for ${DB_NAME} - ${DATE_SUFFIX}"

    echo "  ✓ Committed ${DB_NAME}-dump-${DATE_SUFFIX}.sql"

    # Push to remote
    echo "  Pushing to remote..."
    if git push; then
        echo "    ✓ Pushed successfully"
    else
        echo "    ✗ Push failed"
    fi
else
    echo "  - No changes (${DB_NAME} dump may already exist for today)"
fi

# Cleanup temporary files
echo ""
echo "[3/3] Cleaning up temporary files..."
rm -f "${TEMP_DIR}/${DB_NAME}-dump.sql"
echo "  ✓ Temporary files removed"

echo ""
echo "========================================="
echo "Backup complete!"
echo "========================================="
