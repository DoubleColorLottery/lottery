# DoubleBall Lottery

DoubleBall is a BSC lottery built around a Flap Tax Token V3 and the Flap vault path. The monorepo contains:

- `apps/web`: Nuxt frontend, Nitro APIs, background workers, and generated ABIs
- `packages/contracts`: the Flap lottery, revenue vault/factory, Foundry tests, and deployment tooling

Eligibility uses server-signed EIP-712 balance certificates. The server indexes ERC-20 transfers, commits the complete round manifest before requesting VRF, and stores every signature before a round can enter the drawing phase.

## Commands

```bash
bun install
bun run build
bun run test
bun run test:fork
bun run test:web:e2e:flap-eligibility
bun run verify:flap-port
bun run audit:contracts
```

`bun run verify:flap-port` is the complete release gate. It checks formatting and bytecode sizes, runs unit and live VaultPortal fork tests, synchronizes ABIs, exercises a real SurrealDB eligibility lifecycle, builds the production web app, and runs hardening and dependency checks.

## Application modes

Production uses `NUXT_PUBLIC_APP_MODE=live`. The token, lottery and vault are deployed, and the web app, database and scheduled workers are running. See [the launch record](docs/mainnet-live.md) for addresses and verification results. The optional `prelaunch` mode displays a launch page with workers disabled and no contract configuration.

The normal `live` mode requires the deployed Flap token, lottery, and vault configuration. Start from `.env.example`, keep `.env` owner-only, and use a new SurrealDB database for the new launch:

```bash
cp .env.example .env
chmod 600 .env
bun run docker:up
```

The settlement and eligibility signing keys must resolve to different accounts. Generic `PRIVATE_KEY` is ignored by the web runtime and production preflight. `NUXT_PUBLIC_CHAIN_RPC_URL` is embedded in the browser build, so use a public endpoint, a domain-restricted provider key, or a proxy.

Before enabling live mode, run:

```bash
bun run preflight:production
```

The preflight verifies Flap TaxProcessor and vault bindings, the eligibility signer, deployment blocks, VRF registration and funding, revenue routing, and settlement-wallet readiness without printing private keys.

## Flap contracts

The lottery, vault factory, beacon and implementation are deployed on BSC. See [the preparation record](docs/mainnet-preparation.md). `bun run deploy:prepare` broadcasts only missing preparation transactions, then verifies the contracts. It never launches the token.

Salt search and fresh deployment simulation remain available:

```bash
bun run deploy:flap:find-salt
bun run deploy:flap:dry-run
```

The automated preparation uses the configured owner wallet from the private root `.env`; keys never appear in process arguments. The manual Foundry path also supports encrypted accounts, keystores, hardware wallets and remote signers. The eligibility signer is a separate application secret.

Vendored Flap interfaces and base contracts under `packages/contracts/src/flap` are pinned to `flap-sh/FlapVaultExample` commit `ddae5e03330c4b16525a09b5f03f54f37302b038`.

## Dokploy

Dokploy deploys `deploy/dokploy/compose.yml`. The current compose is intentionally web-only and contract-disabled. See [the Dokploy notes](deploy/dokploy/README.md) for the repository and webhook setup.
