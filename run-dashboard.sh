#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$ROOT_DIR/dashboard"

cd "$DASHBOARD_DIR"
go build -o career-dashboard .
exec ./career-dashboard --path .. "$@"
