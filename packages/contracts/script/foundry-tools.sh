#!/bin/bash
set -euo pipefail

foundry_tool_is_valid() {
  local tool=$1
  local candidate=$2
  local output

  if [ ! -x "$candidate" ]; then
    return 1
  fi

  output=$("$candidate" --version 2>/dev/null || true)
  case "$output" in
    *"$tool Version:"*) return 0 ;;
    *) return 1 ;;
  esac
}

resolve_foundry_tool() {
  local tool=$1
  local candidate
  local candidates=()

  if [ -n "${FOUNDRY_BIN_DIR:-}" ]; then
    candidates+=("$FOUNDRY_BIN_DIR/$tool")
  fi

  candidates+=(
    "$HOME/.foundry/bin/$tool"
    "$HOME/.config/.foundry/bin/$tool"
  )

  if command -v "$tool" >/dev/null 2>&1; then
    candidates+=("$(command -v "$tool")")
  fi

  for candidate in "${candidates[@]}"; do
    if foundry_tool_is_valid "$tool" "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  echo "Error: Foundry $tool not found." >&2
  echo "Install Foundry, or set FOUNDRY_BIN_DIR to the directory containing Foundry's forge/cast/anvil binaries." >&2
  return 1
}

setup_foundry_tools() {
  for tool in "$@"; do
    case "$tool" in
      forge) FOUNDRY_FORGE=$(resolve_foundry_tool forge) ;;
      cast) FOUNDRY_CAST=$(resolve_foundry_tool cast) ;;
      anvil) FOUNDRY_ANVIL=$(resolve_foundry_tool anvil) ;;
      *)
        echo "Unknown Foundry tool: $tool" >&2
        return 1
        ;;
    esac
  done
}

forge() {
  if [ -z "${FOUNDRY_FORGE:-}" ]; then
    FOUNDRY_FORGE=$(resolve_foundry_tool forge)
  fi
  "$FOUNDRY_FORGE" "$@"
}

cast() {
  if [ -z "${FOUNDRY_CAST:-}" ]; then
    FOUNDRY_CAST=$(resolve_foundry_tool cast)
  fi
  "$FOUNDRY_CAST" "$@"
}

anvil() {
  if [ -z "${FOUNDRY_ANVIL:-}" ]; then
    FOUNDRY_ANVIL=$(resolve_foundry_tool anvil)
  fi
  "$FOUNDRY_ANVIL" "$@"
}
