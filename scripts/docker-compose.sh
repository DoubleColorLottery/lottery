#!/bin/bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
  exec docker compose "$@"
fi

if command -v docker-compose >/dev/null 2>&1; then
  exec docker-compose "$@"
fi

echo "Error: Docker Compose is not installed." >&2
echo 'Install the Docker Compose plugin (`docker compose`) or the legacy docker-compose binary.' >&2
exit 1
