#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_CONFIG_DIR="$(cd "$CONTRACTS_DIR/../../apps/web/config" && pwd)"

inspect_abi() {
  local contract="$1"
  local output="$2"
  bash "$SCRIPT_DIR/foundry.sh" forge inspect "$contract" abi --json \
    | perl -ne 'print if /^\[/ .. eof' > "$output"
}

cd "$CONTRACTS_DIR"
inspect_abi "src/flap/IFlapTaxTokenV3.sol:IFlapTaxTokenV3" "$WEB_CONFIG_DIR/token-abi.json"
inspect_abi "src/lottery/FlapDoubleBallLottery.sol:FlapDoubleBallLottery" "$WEB_CONFIG_DIR/lottery-abi.json"
inspect_abi "src/vault/LotteryRevenueVault.sol:LotteryRevenueVault" "$WEB_CONFIG_DIR/vault-abi.json"
inspect_abi "src/vault/LotteryRevenueVaultFactory.sol:LotteryRevenueVaultFactory" "$WEB_CONFIG_DIR/vault-factory-abi.json"
inspect_abi "src/flap/ITaxProcessor.sol:ITaxProcessor" "$WEB_CONFIG_DIR/tax-processor-abi.json"

