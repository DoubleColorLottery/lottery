import { describe, expect, test } from "bun:test";
import { getCronSecretStatus, verifyCronSecret } from "../../apps/web/server/utils/cronAuth";

describe("cron authentication", () => {
  test("requires a configured secret with enough entropy", () => {
    expect(getCronSecretStatus({})).toEqual({ configured: false, validLength: false });
    expect(getCronSecretStatus({ CRON_SECRET: "short" })).toEqual({ configured: true, validLength: false });
    expect(getCronSecretStatus({ CRON_SECRET: "0123456789abcdef" })).toEqual({
      configured: true,
      validLength: true,
    });
  });

  test("matches only the exact cron secret", () => {
    const expected = "0123456789abcdef0123456789abcdef";

    expect(verifyCronSecret(expected, expected)).toBe(true);
    expect(verifyCronSecret("wrong-secret", expected)).toBe(false);
    expect(verifyCronSecret("", expected)).toBe(false);
    expect(verifyCronSecret(expected, "too-short")).toBe(false);
  });
});
