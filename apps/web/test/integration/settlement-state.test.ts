import { describe, expect, test } from "bun:test";
import {
  assertSuccessfulReceipt,
  isTransactionReceiptCanonical,
  serverChain,
} from "../../server/utils/contract";
import { getServerConfig, validateConfig } from "../../server/utils/config";
import { classifyRoundLifecycle } from "../../server/utils/settlement";

const transactionHash = `0x${"ab".repeat(32)}` as const;

describe("settlement state and receipt guards", () => {
  test("treats a settled but undrawn round as cancelled", () => {
    expect(classifyRoundLifecycle({ drawn: false, settled: true })).toBe("cancelled");
    expect(classifyRoundLifecycle({ drawn: true, settled: true })).toBe("settled");
    expect(classifyRoundLifecycle({ drawn: true, settled: false })).toBe("ready-to-settle");
    expect(classifyRoundLifecycle({ drawn: false, settled: false })).toBe("waiting-for-draw");
  });

  test("accepts only successful transaction receipts", () => {
    expect(() => assertSuccessfulReceipt(
      { status: "success", transactionHash },
      "test operation",
    )).not.toThrow();

    expect(() => assertSuccessfulReceipt(
      { status: "reverted", transactionHash },
      "test operation",
    )).toThrow(`test operation transaction reverted: ${transactionHash}`);
  });

  test("configures server-side viem multicalls", () => {
    expect(serverChain.contracts?.multicall3).toBeDefined();
  });

  test("requires an explicit positive receipt finality policy", () => {
    const config = getServerConfig({
      TOKEN_ADDRESS: "0x1111111111111111111111111111111111111111",
      LOTTERY_ADDRESS: "0x2222222222222222222222222222222222222222",
      RPC_URL: "https://bsc.example.invalid",
      TRANSACTION_CONFIRMATIONS: "7",
    });
    expect(config.transactionConfirmations).toBe(7);
    expect(getServerConfig({}).transactionConfirmations).toBe(3);
    expect(getServerConfig({ CHAIN_ID: "31337" }).transactionConfirmations).toBe(1);
    expect(validateConfig({ ...config, transactionConfirmations: 0 }).errors).toContain(
      "TRANSACTION_CONFIRMATIONS must be a positive integer",
    );
  });

  test("recognizes orphaned settlement receipts by block hash", async () => {
    const blockHash = `0x${"cd".repeat(32)}` as const;
    const receipt = {
      status: "success" as const,
      blockNumber: 42n,
      blockHash,
    };
    const canonicalClient = {
      getTransactionReceipt: async () => receipt,
      getBlock: async () => ({ hash: blockHash }),
    };
    const orphanedClient = {
      ...canonicalClient,
      getBlock: async () => ({ hash: `0x${"ef".repeat(32)}` as const }),
    };

    expect(await isTransactionReceiptCanonical(transactionHash, canonicalClient)).toBe(true);
    expect(await isTransactionReceiptCanonical(transactionHash, orphanedClient)).toBe(false);
  });
});
