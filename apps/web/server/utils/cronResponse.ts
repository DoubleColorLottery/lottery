import { setResponseStatus, type H3Event } from "h3";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function reportedFailure(result: unknown): { error: string } | null {
  const outcome = isRecord(result) && "result" in result ? result.result : result;
  if (!isRecord(outcome) || outcome.success !== false) return null;
  return { error: typeof outcome.error === "string" ? outcome.error : "Cron task failed" };
}

export function buildCronTaskResponse(task: string, result: unknown, timestamp = new Date().toISOString()) {
  const failure = reportedFailure(result);
  return {
    statusCode: failure ? 500 : 200,
    body: {
      ok: failure === null,
      task,
      timestamp,
      ...(failure ?? {}),
      result,
    },
  };
}

export function respondToCronTask(event: H3Event, task: string, result: unknown) {
  const response = buildCronTaskResponse(task, result);
  if (response.statusCode !== 200) setResponseStatus(event, response.statusCode);
  return response.body;
}
