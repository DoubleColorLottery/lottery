import { describe, expect, test } from "bun:test";
import {
  getPreflightSettlerPrivateKey,
  getPreflightSettlerPrivateKeySource,
  normalizePreflightPrivateKey,
  preflightSettlerPrivateKeyRequiredMessage,
} from "../../scripts/production-preflight";
import {
  getServerConfig,
  getSettlerPrivateKey,
  getSettlerPrivateKeySource,
  isValidSettlerPrivateKey,
  normalizeSettlerPrivateKey,
  settlerPrivateKeyRequiredMessage,
  validateConfig,
} from "../../apps/web/server/utils/config";

const validPrivateKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    TOKEN_ADDRESS: "0x1111111111111111111111111111111111111111",
    LOTTERY_ADDRESS: "0x2222222222222222222222222222222222222222",
    RPC_URL: "https://bsc-dataseed.binance.org",
    CHAIN_ID: "56",
    BSC_MAINNET_PRIVATE_KEY: validPrivateKey,
    ...overrides,
  };
}

describe("settler key configuration", () => {
  test("uses only BSC_MAINNET_PRIVATE_KEY", () => {
    const env = {
      BSC_MAINNET_PRIVATE_KEY: "bsc-mainnet-key",
    };

    expect(getSettlerPrivateKeySource(env)).toBe("BSC_MAINNET_PRIVATE_KEY");
    expect(getSettlerPrivateKey(env)).toBe("bsc-mainnet-key");
  });

  test("does not silently use generic PRIVATE_KEY in the web runtime", () => {
    const env = {
      PRIVATE_KEY: "generic-private-key",
    };

    expect(getSettlerPrivateKeySource(env)).toBeNull();
    expect(getSettlerPrivateKey(env)).toBe("");
  });

  test("uses the same settler key name in production preflight", () => {
    const env = {
      BSC_MAINNET_PRIVATE_KEY: "bsc-mainnet-key",
    };

    expect(getPreflightSettlerPrivateKeySource(env)).toBe("BSC_MAINNET_PRIVATE_KEY");
    expect(getPreflightSettlerPrivateKey(env)).toBe("bsc-mainnet-key");
    expect(preflightSettlerPrivateKeyRequiredMessage).toBe(settlerPrivateKeyRequiredMessage);
  });

  test("does not use generic PRIVATE_KEY in production preflight", () => {
    const env = {
      PRIVATE_KEY: validPrivateKey,
    };

    expect(getPreflightSettlerPrivateKeySource(env)).toBeNull();
    expect(getPreflightSettlerPrivateKey(env)).toBe("");
    expect(preflightSettlerPrivateKeyRequiredMessage.split(" or ")).not.toContain("PRIVATE_KEY");
    expect(normalizePreflightPrivateKey(validPrivateKey)).toBe(`0x${validPrivateKey}`);
    expect(normalizePreflightPrivateKey("0x123")).toBeNull();
  });

  test("reports the single accepted settler key name", () => {
    expect(settlerPrivateKeyRequiredMessage).toBe("BSC_MAINNET_PRIVATE_KEY is required");
  });

  test("validates complete production runtime config strictly", () => {
    const config = getServerConfig(validEnv());
    expect(validateConfig(config)).toEqual({ valid: true, errors: [] });
    expect(config.multicall3Address).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
    expect(config.multicall3BlockCreated).toBe(15_921_452);
    expect(normalizeSettlerPrivateKey(validPrivateKey)).toBe(`0x${validPrivateKey}`);
    expect(isValidSettlerPrivateKey(validPrivateKey)).toBe(true);
  });

  test("shares the public chain id when a separate server chain id is omitted", () => {
    expect(
      getServerConfig(
        validEnv({
          CHAIN_ID: undefined,
          NUXT_PUBLIC_CHAIN_ID: "31337",
        }),
      ).chainId,
    ).toBe(31337);
  });

  test("rejects malformed contract addresses, rpc urls, chain ids, and settler keys", () => {
    const result = validateConfig(
      getServerConfig(
        validEnv({
          TOKEN_ADDRESS: "0x123",
          LOTTERY_ADDRESS: "not-an-address",
          RPC_URL: "wss://bsc.example.invalid",
          CHAIN_ID: "56abc",
          BSC_MAINNET_PRIVATE_KEY: "0x123",
          MULTICALL3_ADDRESS: "0x123",
          MULTICALL3_BLOCK_CREATED: "not-a-block",
        }),
      ),
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("TOKEN_ADDRESS is not set or invalid");
    expect(result.errors).toContain("LOTTERY_ADDRESS is not set or invalid");
    expect(result.errors).toContain("RPC_URL is not set or invalid");
    expect(result.errors).toContain("CHAIN_ID is invalid");
    expect(result.errors).toContain("MULTICALL3_ADDRESS is invalid");
    expect(result.errors).toContain("MULTICALL3_BLOCK_CREATED is invalid");
    expect(result.errors).toContain("configured settler private key is invalid");
    expect(isValidSettlerPrivateKey("0x123")).toBe(false);
  });
});
