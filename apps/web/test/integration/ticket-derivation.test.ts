import { describe, expect, test } from "bun:test";
import { type Address } from "viem";
import { deriveFlapTicket } from "../../server/utils/ticketDerivation";

describe("Flap ticket derivation", () => {
  test("is deterministic and domain-separated by chain and lottery", () => {
    const lottery = "0x4444444444444444444444444444444444444444" as Address;
    const user = "0x1111111111111111111111111111111111111111" as Address;
    const ticket = deriveFlapTicket(56n, lottery, user, 7n, 2n);

    expect(ticket).toEqual({ redBalls: [5, 7, 9, 11, 27, 33], blueBall: 1 });
    expect(deriveFlapTicket(56n, lottery, user, 7n, 2n)).toEqual(ticket);
    expect(deriveFlapTicket(97n, lottery, user, 7n, 2n)).not.toEqual(ticket);
    expect(
      deriveFlapTicket(56n, "0x5555555555555555555555555555555555555555", user, 7n, 2n),
    ).not.toEqual(ticket);
  });
});
