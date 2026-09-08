import { describe, expect, test } from "bun:test";
import { withStableLiveActivityId } from "../../server/utils/live-activity";

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
