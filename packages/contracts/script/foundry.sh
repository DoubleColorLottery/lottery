#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/foundry-tools.sh"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <forge|cast|anvil> [args...]" >&2
  exit 1
fi

TOOL=$1
shift

TOOL_PATH=$(resolve_foundry_tool "$TOOL")
exec "$TOOL_PATH" "$@"
