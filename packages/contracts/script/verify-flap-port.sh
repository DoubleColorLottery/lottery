#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CONTRACTS_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_DIR=$(cd "$CONTRACTS_DIR/../.." && pwd)

cd "$CONTRACTS_DIR"
rtk bash script/foundry.sh forge fmt --check \
  src/lottery/FlapDoubleBallLottery.sol \
  src/lottery/FlapLotteryTypes.sol \
  src/vault/LotteryRevenueVault.sol \
  src/vault/LotteryRevenueVaultFactory.sol \
  script/DeployFlapVaultPort.s.sol \
  script/FindFlapSalt.s.sol \
  test/foundry/FlapLottery.t.sol \
  test/foundry/FlapRevenueVault.t.sol \
  test/foundry/FlapVaultPortalFork.t.sol
rtk bash script/foundry.sh forge build --sizes
rtk bash script/foundry.sh forge test -vv
rtk bash script/foundry.sh forge test --no-match-contract '^$' --match-contract FlapVaultPortalForkTest -vv
rtk bash script/sync-flap-abi.sh

cd "$REPO_DIR"
rtk bun run test:web
rtk bun run test:web:e2e:flap-eligibility
rtk bun run test:web:e2e:flap-settlement
rtk bun run build:web
rtk bun run test:production
rtk bun run audit:web-performance
rtk bun run audit:dependencies
