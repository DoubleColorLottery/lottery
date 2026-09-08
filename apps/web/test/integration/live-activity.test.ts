import { describe, expect, test, spyOn } from "bun:test";
import { withStableLiveActivityId, scanRecentLiveActivity } from "../../server/utils/live-activity";

describe("live activity identity", () => {
  test("uses the event position as a stable DB/RPC-independent key", () => {
    const claim = withStableLiveActivityId({
      type: "claim",
      blockNumber: 123,
      logIndex: 4,
      user: "0x1111111111111111111111111111111111111111",
      roundId: 7,
      ticketIndex: 2,
      prize: "100",
      tier: 1,
    });
    const draw = withStableLiveActivityId({
      type: "draw",
      blockNumber: 123,
      logIndex: 5,
      roundId: 7,
      redBalls: [1, 2, 3, 4, 5, 6],
      blueBall: 7,
    });

    expect(claim.id).toBe("claim:123:4");
    expect(draw.id).toBe("draw:123:5");
    expect(withStableLiveActivityId({ ...claim, id: "db-generated" }).id).toBe("claim:123:4");
  });
});


test("activity keeps claims older than 2000 blocks during quiet periods", async () => {
  const { publicClient } = await import("../../server/utils/contract");
  const { serverConfig } = await import("../../server/utils/config");
  const previousDeployment = serverConfig.lotteryDeploymentBlock;
  serverConfig.lotteryDeploymentBlock = 100;
  const block = spyOn(publicClient, "getBlockNumber").mockResolvedValue(5000n);
  const logs = spyOn(publicClient, "getLogs").mockImplementation(async (request: any) => {
    if (request.event.name !== "WinningsClaimed" || request.fromBlock > 150n || request.toBlock < 150n) return [];
    return [{ blockNumber: 150n, logIndex: 1, transactionHash: "0x" + "ab".repeat(32), args: {
      user: "0x1111111111111111111111111111111111111111", roundId: 1n, ticketIndex: 0n, prize: 10n, tier: 6,
    } }] as any;
  });
  try {
    const result = await scanRecentLiveActivity();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.blockNumber).toBe(150);
    expect(result.items[0]?.transactionHash).toBe("0x" + "ab".repeat(32));
    expect(logs.mock.calls.every(([request]: any) => request.fromBlock >= 100n)).toBe(true);
  } finally {
    block.mockRestore();
    logs.mockRestore();
    serverConfig.lotteryDeploymentBlock = previousDeployment;
  }
});
