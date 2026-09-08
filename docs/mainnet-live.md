# BSC launch, 8 September 2026

The token, public lottery interface and backend are live at https://doublecolor.fun. The database, scheduled workers and production health checks are active.

This uses `NUXT_PUBLIC_APP_MODE=live` with `NUXT_PUBLIC_SCREEN_MODE=live`. The optional screen setting can display a holding page independently of backend operation. Do not switch to the web-only `compose.yml` to hide the interface, since that disables backend services.

| Contract | Address |
| --- | --- |
| Token, 双色球 | `0xf13c4210F7aEd1C0614D517D7bfa434355397777` |
| Lottery | `0xb1d9B66beeec92186B67da477C5F7e88b7354dfa` |
| Revenue vault | `0x83d7090969007dA5D9edD41A1b83BD5796B4f9b0` |
| Tax processor | `0xAe93Dbbb7AaAAf345299b0Cd782429C113187632` |

The token launch transaction is `0x7147946dab572ccb86672d54cb6f0de67811e403c68ae057ede31ca135bfec07`, mined at block `120719893`. The lottery was enabled in transaction `0xc2d2e0a85db61d6847e5a1a55df96cb6dbb406d2e423330681e46df80583af20`. Buy and sell tax are both 2%, plus the Portal's 1% base fee for a total bonding-curve fee of 3% per side, with 100% of distributable tax allocated to the vault. No initial purchase was made.

The token, vault proxy, lottery, factory, beacon and vault implementation have verified source on BscScan. The processor holds WBNB internally and unwraps it for native BNB vault payments. Readiness checks require the canonical BSC WBNB address, `feeConfig.isWeth=true`, and a native-currency vault. The live Portal fork test verifies this path through a trade, dispatch and vault flush.

Dokploy deploys `deploy/dokploy/compose.live.yml` from its separately configured production source. Publishing the public repository does not change that configuration. Both web and SurrealDB containers are healthy. The database is `lottery/flap_b1d9B66b`. Settlement and activity sync run every minute; ticket caching runs every ten minutes. Startup tasks are enabled.

Production `/api/health` and `/api/operational-readiness` check the configured backend independently of the holding screen. The public runtime configuration includes the token, lottery and vault addresses. Contract configuration, round status, activity APIs and authenticated worker endpoints are available while the lottery interface is hidden.

At launch, VRF subscription `171` held `0.005 BNB`, the settler held approximately `0.0739 BNB`, and the separate eligibility signer matched the lottery. No funded round or user claim has occurred yet. Those flows passed the contract and settlement integration tests before deployment.

Private state is stored in `.launch/prepared.json`, `.launch/addresses.json`, `.launch/launch.json`, and `.launch/runtime.json`. The preparation addresses file describes the pre-token preparation; use the runtime file and launch receipts for final token/vault configuration. Keep owner-only backups outside the repository. Never delete or regenerate the launch journal to retry deployment.

The current creator and lottery owner is `0x518471B3B9696b6340C245D45a1C9428036f3c2a`, with no pending owner. Flap Portal owns the token and tax processor. Flap Guardian `0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b` retains vault upgrade authority through the factory, as requested. The fresh eligibility signer is `0xEa194C24C1f7F46D3CF5d72c27a4BaFE70Bb9d5D`; it has signing authority, not ownership. No previous project wallet is assigned an owner/admin role in this deployment.

Run `bun scripts/launch/audit.ts` to check ownership, runtime keys, zero commission receiver, Guardian upgrade simulation, rejection of wallets listed in the private `RETIRED_PROJECT_WALLETS` environment variable, and live total bonding-curve fees. Flap's base fee is protocol-controlled; after DEX migration, pool fees are separate.

The earlier 5% and 3% token-tax launches remain onchain and have archived private journals. The website now uses only the deployment above.
