# Dokploy deployment

The public source repository is `git@github.com:DoubleColorLottery/lottery.git`, branch `main`. Publishing code here does not change the existing production deployment source.

For a new deployment, use `deploy/dokploy/compose.live.yml`. It runs the web app and SurrealDB with startup tasks and scheduled workers enabled. Configure the repository, branch and domain in Dokploy, and keep private runtime values in its environment settings.

See [the launch record](../../docs/mainnet-live.md) for the current contracts. The original `compose.yml` is a web-only prelaunch configuration. To hide the public lottery interface while leaving the backend active, use the live compose with `NUXT_PUBLIC_SCREEN_MODE=prelaunch`.

If push deployment is desired, configure a GitHub push webhook separately. Keep webhook credentials private. Suggested watch paths are `apps/web/**`, `packages/contracts/**`, `package.json`, `bun.lock`, `Dockerfile`, `deploy/dokploy/**`, and `docker-compose.yml`.
