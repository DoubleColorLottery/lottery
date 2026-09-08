/**
 * Server-side configuration - Single source of truth
 * All values read from environment variables
 */

import { isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BSC_MULTICALL3_BLOCK_CREATED, CANONICAL_MULTICALL3_ADDRESS } from "../../config/runtimeChain";

// Required environment variables
const requiredEnvVars = ["TOKEN_ADDRESS", "LOTTERY_ADDRESS", "RPC_URL"] as const;
const settlerPrivateKeyEnvVars = ["BSC_MAINNET_PRIVATE_KEY"] as const;

type RuntimeEnv = Record<string, string | undefined>;
export type SettlerPrivateKeyEnvVar = (typeof settlerPrivateKeyEnvVars)[number];

export const settlerPrivateKeyRequiredMessage = "BSC_MAINNET_PRIVATE_KEY is required";

export interface ServerConfig {
  tokenAddress: Address | "";
  lotteryAddress: Address | "";
  vaultAddress: Address | "";
  rpcUrl: string;
  settlerPrivateKey: string;
  eligibilitySignerPrivateKey: string;
  chainId: number;
  tokenDeploymentBlock: number;
  lotteryDeploymentBlock: number;
  eligibilityLogChunkSize: number;
  transactionConfirmations: number;
  multicall3Address: Address | "";
  multicall3BlockCreated: number;
}

export function getSettlerPrivateKeySource(env: RuntimeEnv = process.env): SettlerPrivateKeyEnvVar | null {
  for (const envVar of settlerPrivateKeyEnvVars) {
    if (env[envVar]) return envVar;
  }

  return null;
}

export function getSettlerPrivateKey(env: RuntimeEnv = process.env): string {
  const source = getSettlerPrivateKeySource(env);
  return source ? env[source] || "" : "";
}

export function normalizeSettlerPrivateKey(privateKey: string): Hex | null {
  if (!privateKey) return null;

  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return null;

  try {
    privateKeyToAccount(normalized as Hex);
    return normalized as Hex;
  } catch {
    return null;
  }
}

export function isValidSettlerPrivateKey(privateKey: string): boolean {
  return normalizeSettlerPrivateKey(privateKey) !== null;
}

export const eligibilitySignerPrivateKeyRequiredMessage = "ELIGIBILITY_SIGNER_PRIVATE_KEY is required";

export function normalizeEligibilitySignerPrivateKey(privateKey: string): Hex | null {
  if (!privateKey) return null;

  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return null;

  try {
    privateKeyToAccount(normalized as Hex);
    return normalized as Hex;
  } catch {
    return null;
  }
}

export function isValidEligibilitySignerPrivateKey(privateKey: string): boolean {
  return normalizeEligibilitySignerPrivateKey(privateKey) !== null;
}

function parseChainId(value: string | undefined): number {
  const raw = value || "56";
  if (!/^\d+$/.test(raw)) return Number.NaN;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function parseNonNegativeSafeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function isValidRpcUrl(value: string): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function getServerConfig(env: RuntimeEnv = process.env): ServerConfig {
  const chainId = parseChainId(env.CHAIN_ID || env.NUXT_PUBLIC_CHAIN_ID);
  return {
    tokenAddress: (env.TOKEN_ADDRESS || "") as Address | "",
    lotteryAddress: (env.LOTTERY_ADDRESS || "") as Address | "",
    vaultAddress: (env.VAULT_ADDRESS || "") as Address | "",
    rpcUrl: env.RPC_URL || "",
    settlerPrivateKey: getSettlerPrivateKey(env),
    eligibilitySignerPrivateKey: env.ELIGIBILITY_SIGNER_PRIVATE_KEY || "",
    chainId,
    tokenDeploymentBlock: parseNonNegativeSafeInteger(env.TOKEN_DEPLOYMENT_BLOCK, 0),
    lotteryDeploymentBlock: parseNonNegativeSafeInteger(env.LOTTERY_DEPLOYMENT_BLOCK, 0),
    eligibilityLogChunkSize: parseNonNegativeSafeInteger(env.ELIGIBILITY_LOG_CHUNK_SIZE, 20_000),
    transactionConfirmations: parseNonNegativeSafeInteger(
      env.TRANSACTION_CONFIRMATIONS,
      chainId === 31337 ? 1 : 3,
    ),
    multicall3Address: (env.MULTICALL3_ADDRESS
      || env.NUXT_PUBLIC_MULTICALL3_ADDRESS
      || CANONICAL_MULTICALL3_ADDRESS) as Address,
    multicall3BlockCreated: parseNonNegativeSafeInteger(
      env.MULTICALL3_BLOCK_CREATED || env.NUXT_PUBLIC_MULTICALL3_BLOCK_CREATED,
      chainId === 56 ? BSC_MULTICALL3_BLOCK_CREATED : 0,
    ),
  };
}

// Validate environment on module load
if (process.env.NUXT_PUBLIC_APP_MODE !== "prelaunch") {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.warn(`Warning: ${envVar} not set in environment`);
    }
  }
}

export const serverConfig = getServerConfig();

// Validation helper
export function validateConfig(config: ServerConfig = serverConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.tokenAddress || !isAddress(config.tokenAddress, { strict: false })) {
    errors.push("TOKEN_ADDRESS is not set or invalid");
  }

  if (!config.lotteryAddress || !isAddress(config.lotteryAddress, { strict: false })) {
    errors.push("LOTTERY_ADDRESS is not set or invalid");
  }

  if (config.vaultAddress && !isAddress(config.vaultAddress, { strict: false })) {
    errors.push("VAULT_ADDRESS is invalid");
  }

  if (!isValidRpcUrl(config.rpcUrl)) {
    errors.push("RPC_URL is not set or invalid");
  }

  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    errors.push("CHAIN_ID is invalid");
  }

  if (!config.multicall3Address || !isAddress(config.multicall3Address, { strict: false })) {
    errors.push("MULTICALL3_ADDRESS is invalid");
  }

  if (!Number.isSafeInteger(config.multicall3BlockCreated) || config.multicall3BlockCreated < 0) {
    errors.push("MULTICALL3_BLOCK_CREATED is invalid");
  }

  if (config.settlerPrivateKey && !isValidSettlerPrivateKey(config.settlerPrivateKey)) {
    errors.push("configured settler private key is invalid");
  }


  if (config.eligibilitySignerPrivateKey && !isValidEligibilitySignerPrivateKey(config.eligibilitySignerPrivateKey)) {
    errors.push("ELIGIBILITY_SIGNER_PRIVATE_KEY is invalid");
  }

  if (!Number.isSafeInteger(config.tokenDeploymentBlock) || config.tokenDeploymentBlock < 0) {
    errors.push("TOKEN_DEPLOYMENT_BLOCK is invalid");
  }

  if (!Number.isSafeInteger(config.lotteryDeploymentBlock) || config.lotteryDeploymentBlock < 0) {
    errors.push("LOTTERY_DEPLOYMENT_BLOCK is invalid");
  }

  if (!Number.isSafeInteger(config.eligibilityLogChunkSize) || config.eligibilityLogChunkSize <= 0) {
    errors.push("ELIGIBILITY_LOG_CHUNK_SIZE is invalid");
  }

  if (!Number.isSafeInteger(config.transactionConfirmations) || config.transactionConfirmations <= 0) {
    errors.push("TRANSACTION_CONFIRMATIONS must be a positive integer");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
