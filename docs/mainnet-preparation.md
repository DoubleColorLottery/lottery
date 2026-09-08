# Preparing a deployment

See [the current deployment](mainnet-live.md) for production addresses and health checks.

`bun run deploy:prepare` creates the lottery infrastructure without launching a token. It saves resumable signed transactions in the private, ignored `.launch` directory. `bun run deploy:verify` verifies contracts using `ETHERSCAN_API_KEY` from the private environment.

Keep the deployment wallet, token salt and eligibility key consistent when resuming. Do not delete the launch journal or rebuild different contract bytecode during a retry. Back up private state outside Git.

Run the release gate and `bun run test:launch:fork` before broadcasting a token launch. `bun run deploy:live` requires a clean checkout pushed to `origin/main`, validates token metadata, and configures the backend after onchain readiness passes.
