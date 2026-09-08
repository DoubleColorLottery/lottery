# Flap vault deployment runbook

The current mainnet infrastructure is already deployed. See [the preparation record](mainnet-preparation.md) for its addresses and resumable commands. The full fresh deployment below is reference material; do not run it to finish the prepared launch.

This runbook launches a new Flap Tax Token V3, lottery, vault factory, and vault. The retired application deployment is not reused or mutated.

Production remains in contract-disabled prelaunch mode until every step below has passed review. Do not broadcast from an application deployment.

## Preconditions

- Use BSC mainnet chain ID 56 and an archive-capable RPC for verification.
- Configure a Foundry signer using `FOUNDRY_SIGNER_TYPE`; do not put a raw deployment key in a command.
- Use a separate eligibility signing key. `ELIGIBILITY_SIGNER_ADDRESS` is deployed onchain, while `ELIGIBILITY_SIGNER_PRIVATE_KEY` exists only on the server.
- Use a fresh SurrealDB database name so legacy snapshot data cannot mix with signed Flap rounds.
- Keep `FLAP_INITIAL_BUY_WEI=0` unless the launch transaction is intentionally funded and reviewed.

## 1. Generate a fresh salt

Set a random 32-byte seed and find an unused token address ending in `7777`:

```bash
export FLAP_SALT_SEED=0x...
rtk bun run deploy:flap:find-salt
```

Copy the reported salt to `FLAP_TOKEN_SALT`. Never reuse the salt from tests or documentation. A staged salt will make the Portal launch revert.

## 2. Dry-run the exact launch

Set the token metadata, tax settings, `ELIGIBILITY_SIGNER_ADDRESS`, and signer configuration, then simulate against current BSC state:

```bash
rtk bun run deploy:flap:dry-run
```

The script checks the predicted `7777` token address, VaultPortal registration, token-to-lottery binding, vault quote currency, TaxProcessor market address, and the 100% market allocation. It also creates the VRF subscription, excludes the lottery owner from tickets, and enables the lottery.

## 3. Run the release gate

```bash
rtk bun run verify:flap-port
```

This runs formatting checks, contract sizes, all non-fork contract tests, the live VaultPortal BSC fork test, ABI synchronization, web integration tests, the production build, and production-hardening tests.

## 4. Broadcast

After reviewing the simulation output and deployer balance, use the configured Foundry signer:

```bash
cd packages/contracts
source script/foundry-signer.sh
configure_foundry_signer
rtk bash script/foundry.sh forge script script/DeployFlapVaultPort.s.sol:DeployFlapVaultPort \
  --rpc-url bsc_mainnet \
  --broadcast \
  "${FOUNDRY_SIGNER_ARGS[@]}" \
  -vv
```

Record the emitted token, lottery, vault, factory, TaxProcessor, VRF subscription ID, and deployment block. Fund the new VRF subscription before the first draw.

## 5. Configure the application

Set these server values from the broadcast output:

```dotenv
TOKEN_ADDRESS=0x...
LOTTERY_ADDRESS=0x...
VAULT_ADDRESS=0x...
TOKEN_DEPLOYMENT_BLOCK=...
LOTTERY_DEPLOYMENT_BLOCK=...
ELIGIBILITY_SIGNER_PRIVATE_KEY=...
NUXT_PUBLIC_TOKEN_ADDRESS=0x...
NUXT_PUBLIC_LOTTERY_ADDRESS=0x...
SURREAL_DB=flap-mainnet
```

The public address derived from `ELIGIBILITY_SIGNER_PRIVATE_KEY` must equal the deployed `eligibilitySigner`. Run `rtk bun run preflight:production` and check `/api/operational-readiness` before opening the app.

## Round lifecycle

The settlement service dispatches the TaxProcessor, flushes the vault, advances its persisted token-balance index through a confirmed cutoff block, verifies replayed supply, persists the manifest, calls `prepareRound`, stores every EIP-712 certificate, then calls `requestDraw`. The balance index is published atomically and its cursor block hash is rechecked for reorgs. If the service stops after preparation, the next run resumes the same frozen round instead of rebuilding it.

The eligibility signer is trusted. The manifest hash and aggregate onchain limits make the signed set auditable and bound its total size, but they do not prove each individual balance onchain. Protect and monitor this key independently from the settlement key.
