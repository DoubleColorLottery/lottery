import { isSettlerConfigured, publicClient } from "../utils/contract";
import { getCronSecretStatus } from "../utils/cronAuth";
import { getSettlerPrivateKeySource, settlerPrivateKeyRequiredMessage, validateConfig } from "../utils/config";
import { pingSurrealDB } from "../utils/surrealdb";
import { areBackgroundTasksDisabled } from "../utils/taskControl";

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig();
  if (runtimeConfig.public.appMode === "prelaunch") {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      checks: {
        app: { ok: true, mode: "prelaunch" },
        contracts: { ok: true, skipped: true },
        database: { ok: true, skipped: true },
      },
    };
  }

  const backgroundTasksDisabled = areBackgroundTasksDisabled();
  const useDokployCron = process.env.USE_DOKPLOY_CRON === "1";
  const cronSecretStatus = getCronSecretStatus();
  const config = validateConfig();
  const configErrors = [...config.errors];
  const settlerConfigured = isSettlerConfigured();
  const settlerKeySource = getSettlerPrivateKeySource();

  if (
    runtimeConfig.public.environment === "production"
    && !backgroundTasksDisabled
    && !settlerConfigured
    && !settlerKeySource
  ) {
    configErrors.push(`${settlerPrivateKeyRequiredMessage} for production background tasks`);
  }

  if (runtimeConfig.public.environment === "production" && useDokployCron && !cronSecretStatus.validLength) {
    configErrors.push("CRON_SECRET must be at least 16 characters when USE_DOKPLOY_CRON=1");
  }

  const configValid = configErrors.length === 0;
  const checks: Record<string, unknown> = {
    config: {
      ok: configValid,
      errors: configErrors,
      environment: runtimeConfig.public.environment,
      backgroundTasksDisabled,
      useDokployCron,
      cronSecretConfigured: cronSecretStatus.configured,
      cronSecretValidLength: cronSecretStatus.validLength,
      settlerConfigured,
      settlerKeySource,
    },
  };

  let healthy = configValid;

  try {
    const blockNumber = await publicClient.getBlockNumber();
    checks.rpc = { ok: true, blockNumber: blockNumber.toString() };
  } catch (error) {
    healthy = false;
    console.error("[Health] RPC readiness check failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    checks.rpc = {
      ok: false,
      error: "RPC unavailable",
    };
  }

  if (backgroundTasksDisabled) {
    checks.database = { ok: true, skipped: true };
  } else {
    try {
      await pingSurrealDB();
      checks.database = { ok: true };
    } catch (error) {
      healthy = false;
      console.error("[Health] Database readiness check failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      checks.database = {
        ok: false,
        error: "Database unavailable",
      };
    }
  }

  if (!healthy) {
    setResponseStatus(event, 503);
  }

  return {
    status: healthy ? "ok" : "error",
    timestamp: new Date().toISOString(),
    checks,
  };
});
