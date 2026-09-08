import { describe, expect, test } from "bun:test";
import { buildCronTaskResponse } from "../../server/utils/cronResponse";

describe("cron task responses", () => {
  test("returns a retryable HTTP failure when a task reports failure", () => {
    const response = buildCronTaskResponse(
      "settle",
      { result: { success: false, error: "settlement failed" } },
      "2026-01-01T00:00:00.000Z",
    );

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      ok: false,
      task: "settle",
      timestamp: "2026-01-01T00:00:00.000Z",
      error: "settlement failed",
      result: { result: { success: false, error: "settlement failed" } },
    });
  });

  test("keeps successful, disabled, and lease-skipped runs successful", () => {
    expect(buildCronTaskResponse("settle", { result: "disabled" }).statusCode).toBe(200);
    expect(buildCronTaskResponse("settle", { result: "skipped", skipped: true }).statusCode).toBe(200);
    expect(buildCronTaskResponse("settle", { result: { success: true } }).body.ok).toBe(true);
  });
});
