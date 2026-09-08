import { describe, expect, test } from "bun:test";
import {
  evaluateAutoVrfRetry,
  getAutoVrfRetryPolicy,
  type AutoVrfRetryPolicy,
  type CurrentDrawStatus,
  type VrfSubscriptionStatus,
} from "../../apps/web/server/utils/contract";

const address = "0x0000000000000000000000000000000000000001" as const;

function drawStatus(overrides: Partial<CurrentDrawStatus> = {}): CurrentDrawStatus {
  return {
    currentRoundId: 1n,
    inProgress: true,
    currentBlock: 20_001n,
    drawTimeoutBlocks: 7_200n,
    timeoutBlock: 10_000n,
    requestId: 123n,
    drawn: false,
    canRetry: true,
    ...overrides,
  };
}

function vrfStatus(overrides: Partial<VrfSubscriptionStatus> = {}): VrfSubscriptionStatus {
  return {
    coordinator: address,
    subscriptionId: 150n,
    balance: 5_000_000_000_000_000n,
    reqCount: 0n,
    owner: address,
    consumers: [address],
    hasConsumer: true,
    ready: true,
    ...overrides,
  };
}

function retryPolicy(overrides: Partial<AutoVrfRetryPolicy> = {}): AutoVrfRetryPolicy {
  return {
    enabled: true,
    extraGraceBlocks: 7_200n,
    minSubscriptionBalance: 5_000_000_000_000_000n,
    minSettlerBalance: 7_000_000_000_000_000n,
    ...overrides,
  };
}

describe("auto VRF retry policy", () => {
  test("is disabled by default unless explicitly enabled", () => {
    const policy = getAutoVrfRetryPolicy({});

    expect(policy.enabled).toBe(false);
    expect(policy.extraGraceBlocks).toBe(7_200n);
    expect(policy.minSubscriptionBalance).toBe(5_000_000_000_000_000n);
    expect(policy.minSettlerBalance).toBe(7_000_000_000_000_000n);
  });

  test("allows retry only when every safety gate passes", () => {
    const decision = evaluateAutoVrfRetry(drawStatus(), vrfStatus(), 8_000_000_000_000_000n, retryPolicy());

    expect(decision).toEqual({
      shouldRetry: true,
      reason: "ready",
      earliestRetryBlock: 17_200n,
    });
  });

  test("blocks retry when auto retry is disabled", () => {
    const decision = evaluateAutoVrfRetry(
      drawStatus(),
      vrfStatus(),
      8_000_000_000_000_000n,
      retryPolicy({ enabled: false }),
    );

    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("auto_retry_disabled");
  });

  test("blocks retry before the extra grace window has passed", () => {
    const decision = evaluateAutoVrfRetry(
      drawStatus({ currentBlock: 17_200n }),
      vrfStatus(),
      8_000_000_000_000_000n,
      retryPolicy(),
    );

    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe("extra_grace_pending");
    expect(decision.earliestRetryBlock).toBe(17_200n);
  });

  test("blocks retry when there is no active pending request", () => {
    expect(evaluateAutoVrfRetry(drawStatus({ inProgress: false }), vrfStatus(), 8_000_000_000_000_000n, retryPolicy()).reason).toBe(
      "no_draw_in_progress",
    );
    expect(evaluateAutoVrfRetry(drawStatus({ drawn: true }), vrfStatus(), 8_000_000_000_000_000n, retryPolicy()).reason).toBe(
      "round_already_drawn",
    );
    expect(evaluateAutoVrfRetry(drawStatus({ requestId: 0n }), vrfStatus(), 8_000_000_000_000_000n, retryPolicy()).reason).toBe(
      "no_pending_request",
    );
    expect(evaluateAutoVrfRetry(drawStatus({ canRetry: false }), vrfStatus(), 8_000_000_000_000_000n, retryPolicy()).reason).toBe(
      "draw_not_timed_out",
    );
  });

  test("blocks retry when VRF or settler funding is not ready", () => {
    expect(evaluateAutoVrfRetry(drawStatus(), vrfStatus({ hasConsumer: false }), 8_000_000_000_000_000n, retryPolicy()).reason).toBe(
      "vrf_consumer_missing",
    );
    expect(evaluateAutoVrfRetry(drawStatus(), vrfStatus({ balance: 1n }), 8_000_000_000_000_000n, retryPolicy()).reason).toBe(
      "vrf_subscription_underfunded",
    );
    expect(evaluateAutoVrfRetry(drawStatus(), vrfStatus(), 1n, retryPolicy()).reason).toBe("settler_balance_low");
  });
});
