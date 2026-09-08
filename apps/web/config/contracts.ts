import type { Address } from "viem";
import tokenAbi from "./token-abi.json";
import lotteryAbi from "./lottery-abi.json";
import { getRuntimeChain } from "./runtimeChain";

// Runtime config helper - works in both client and server contexts
const getRuntimeConfig = () => {
  if (typeof useRuntimeConfig !== "undefined") {
    return useRuntimeConfig();
  }
  // Fallback for non-Nuxt contexts (should not happen in normal use)
  return {
    public: {
      tokenAddress: process.env.NUXT_PUBLIC_TOKEN_ADDRESS || "",
      lotteryAddress: process.env.NUXT_PUBLIC_LOTTERY_ADDRESS || "",
      chainRpcUrl: process.env.NUXT_PUBLIC_CHAIN_RPC_URL || "https://bsc-dataseed.binance.org",
      chainId: parseInt(process.env.NUXT_PUBLIC_CHAIN_ID || "56", 10),
      chainName: process.env.NUXT_PUBLIC_CHAIN_NAME || "BSC Mainnet",
      chainCurrencySymbol: process.env.NUXT_PUBLIC_CHAIN_CURRENCY_SYMBOL || "BNB",
      chainBlockExplorerUrl: process.env.NUXT_PUBLIC_CHAIN_BLOCK_EXPLORER_URL || "https://bscscan.com",
    },
  };
};

// Token contract getter
export const getTokenContract = () => {
  const config = getRuntimeConfig();
  return {
    address: config.public.tokenAddress as Address,
    abi: tokenAbi,
    chain: getRuntimeChain(),
  };
};

// Lottery contract getter
export const getLotteryContract = () => {
  const config = getRuntimeConfig();
  return {
    address: config.public.lotteryAddress as Address,
    abi: lotteryAbi,
    chain: getRuntimeChain(),
  };
};

export const getNetworkConfig = () => {
  const chain = getRuntimeChain();
  return {
    bsc: {
      ...chain,
      network: "bsc",
      rpcUrls: { ...chain.rpcUrls, public: chain.rpcUrls.default },
    },
  };
};

// For backwards compatibility - these create new objects each call
export const TOKEN_CONTRACT = {
  get address() {
    return getRuntimeConfig().public.tokenAddress as Address;
  },
  abi: tokenAbi,
  get chain() {
    return getRuntimeChain();
  },
};

export const LOTTERY_CONTRACT = {
  get address() {
    return getRuntimeConfig().public.lotteryAddress as Address;
  },
  abi: lotteryAbi,
  get chain() {
    return getRuntimeChain();
  },
};

export const NETWORK_CONFIG = {
  get bsc() {
    return getNetworkConfig().bsc;
  },
};
