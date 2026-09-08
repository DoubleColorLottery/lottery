import { describe, expect, test } from "bun:test";
import { predictToken } from "../../scripts/launch/prepare";
import { sendJournaled, type LaunchJournal } from "../../scripts/launch/transactions";
import { Wallet, keccak256 } from "ethers";

describe("resumable launch", () => {
  test("predicts the exact Flap clone address from the verified fork vector", () => {
    expect(predictToken("0xafa095a04e18c20d707652f96d769afc487d491fae89b98407572779b2290d7f"))
      .toBe("0x3CAF2731d86FBfDFf57b2cC362e12BD1C6557777");
  });

  test("saves before broadcast and reuses a confirmed transaction on retry", async () => {
    const wallet = Wallet.createRandom();
    const journal: LaunchJournal = { fingerprint: "test", salt: "test", transactions: {} };
    let saved = false;
    let confirmed = false;
    let broadcasts = 0;
    const receipt = { hash: "receipt", status: 1, confirmations: async () => 3 };
    const provider = {
      getTransactionCount: async () => 0,
      estimateGas: async () => 21000n,
      getFeeData: async () => ({ gasPrice: 1000000000n }),
      getTransactionReceipt: async () => confirmed ? receipt : null,
      getTransaction: async () => null,
      broadcastTransaction: async (raw: string) => {
        expect(saved).toBe(true);
        expect(journal.transactions.transfer.hash).toBe(keccak256(raw));
        broadcasts++;
      },
      waitForTransaction: async () => { confirmed = true; return receipt; },
    };
    const request = { to: "0x0000000000000000000000000000000000001234", value: 1n };
    await sendJournaled("transfer", request, wallet as any, provider as any, journal, () => { saved = true; });
    await sendJournaled("transfer", request, wallet as any, provider as any, journal, () => { throw new Error("must not resign"); });
    expect(broadcasts).toBe(1);
    await expect(sendJournaled("transfer", { ...request, value: 2n }, wallet as any, provider as any, journal, () => {}))
      .rejects.toThrow("does not match");
  });
});
