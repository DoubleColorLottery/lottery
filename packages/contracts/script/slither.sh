#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PACKAGE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
source "$SCRIPT_DIR/foundry-tools.sh"
setup_foundry_tools forge

DETECTORS="reentrancy-eth,unchecked-lowlevel,arbitrary-send-eth,locked-ether,timestamp,tx-origin,weak-prng,unused-return"
SOLC_ARGS="--via-ir --optimize --optimize-runs 200"

if ! command -v slither >/dev/null 2>&1; then
  echo "slither is not installed. Install it with: pipx install slither-analyzer"
  exit 1
fi

if ! slither --version >/dev/null 2>&1; then
  echo "slither is installed but failed to start. Reinstall it with:"
  echo "  pipx reinstall slither-analyzer"
  echo "or:"
  echo "  pipx install --force slither-analyzer"
  exit 1
fi

if ! command -v solc >/dev/null 2>&1; then
  echo "solc is not installed. Install/select 0.8.28 with:"
  echo "  pipx install solc-select"
  echo "  solc-select install 0.8.28"
  echo "  solc-select use 0.8.28"
  exit 1
fi

if ! solc --version >/dev/null 2>&1; then
  echo "solc is installed but failed to start. Reinstall/select 0.8.28 with:"
  echo "  pipx reinstall solc-select"
  echo "  solc-select install 0.8.28"
  echo "  solc-select use 0.8.28"
  exit 1
fi

cd "$PACKAGE_DIR"
forge flatten src/lottery/FlapDoubleBallLottery.sol > "$TMP_DIR/FlapDoubleBallLottery.flat.sol"
forge flatten src/vault/LotteryRevenueVault.sol > "$TMP_DIR/LotteryRevenueVault.flat.sol"
forge flatten src/vault/LotteryRevenueVaultFactory.sol > "$TMP_DIR/LotteryRevenueVaultFactory.flat.sol"

run_slither() {
  local title="$1"
  local target="$2"

  echo "=== Slither: $title ==="
  (
    cd "$TMP_DIR"
    slither "$target" \
      --compile-force-framework solc \
      --solc-args "$SOLC_ARGS" \
      --detect "$DETECTORS" \
      --fail-none
  )
}

run_slither "FlapDoubleBallLottery" "FlapDoubleBallLottery.flat.sol"
echo ""
run_slither "LotteryRevenueVault" "LotteryRevenueVault.flat.sol"
echo ""
run_slither "LotteryRevenueVaultFactory" "LotteryRevenueVaultFactory.flat.sol"
