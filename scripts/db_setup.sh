#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  . ./.env
  set +a
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required on PATH." >&2
  exit 1
fi

DB_URL="${DATABASE_URL:-postgres://localhost:5432/dox?sslmode=disable}"
DB_NAME="$(echo "$DB_URL" | sed -E 's#postgres://[^/]+/([^?]+).*#\1#')"
ADMIN_URL="$(echo "$DB_URL" | sed -E 's#(postgres://[^/]+/)[^?]+#\1postgres#')"

if [[ -z "$DB_NAME" || "$DB_NAME" == "$DB_URL" ]]; then
  echo "Could not parse database name from DATABASE_URL." >&2
  exit 1
fi

if ! psql "$ADMIN_URL" -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "Creating database ${DB_NAME}"
  psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${DB_NAME}\";"
fi

echo "Running migrations"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f internal/store/migrations/001_init.sql

echo "Done"
