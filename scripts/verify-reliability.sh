#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

cd "$REPO_DIR"
rtk bun run build:contracts
rtk bun run test:contracts
rtk bun run test:web
rtk bun run test:web:e2e:flap-eligibility
rtk bun run test:web:e2e:flap-settlement
rtk bun run test:production
rtk bun run build:web
