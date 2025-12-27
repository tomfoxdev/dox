#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  . ./.env
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgres://localhost:5432/dox?sslmode=disable}"

go run ./cmd/server
