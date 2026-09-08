export function areBackgroundTasksDisabled(): boolean {
  return process.env.DISABLE_STARTUP_TASKS === "1";
}

export function areStartupTasksDisabled(): boolean {
  return areBackgroundTasksDisabled() || process.env.USE_DOKPLOY_CRON === "1";
}
