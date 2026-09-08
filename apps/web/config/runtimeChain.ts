import { defineChain, getAddress, isAddress, type AddEthereumChainParameter, type Chain } from "viem";

export const CANONICAL_MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const BSC_MULTICALL3_BLOCK_CREATED = 15_921_452;

export interface RuntimeChainConfig {
  chainId: number;
  chainName: string;
  chainCurrencySymbol: string;
  chainRpcUrl: string;
  chainBlockExplorerUrl: string;
  multicall3Address?: string;
  multicall3BlockCreated?: number;
}

const requireText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
};

const requireHttpUrl = (value: string, field: string): string => {
  const normalized = requireText(value, field);
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${field} must be an HTTP(S) URL`);
  }
};

export const createRuntimeChain = (config: RuntimeChainConfig): Chain => {
  if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
    throw new Error("chainId must be a positive safe integer");
  }

  const name = requireText(config.chainName, "chainName");
  const symbol = requireText(config.chainCurrencySymbol, "chainCurrencySymbol");
  const rpcUrl = requireHttpUrl(config.chainRpcUrl, "chainRpcUrl");
  const explorerUrl = config.chainBlockExplorerUrl.trim()
    ? requireHttpUrl(config.chainBlockExplorerUrl, "chainBlockExplorerUrl")
    : "";
  const rawMulticallAddress = config.multicall3Address?.trim() || CANONICAL_MULTICALL3_ADDRESS;
  if (!isAddress(rawMulticallAddress, { strict: false })) {
    throw new Error("multicall3Address must be a valid address");
  }
  const multicall3BlockCreated = config.multicall3BlockCreated
    ?? (config.chainId === 56 ? BSC_MULTICALL3_BLOCK_CREATED : 0);
  if (!Number.isSafeInteger(multicall3BlockCreated) || multicall3BlockCreated < 0) {
    throw new Error("multicall3BlockCreated must be a non-negative safe integer");
  }

  return defineChain({
    id: config.chainId,
    name,
    nativeCurrency: { name: symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    contracts: {
      multicall3: {
        address: getAddress(rawMulticallAddress),
        blockCreated: multicall3BlockCreated,
      },
    },
    ...(explorerUrl
      ? { blockExplorers: { default: { name: `${name} Explorer`, url: explorerUrl } } }
      : {}),
  });
};

export const getRuntimeChainConfig = (): RuntimeChainConfig => {
  if (typeof useRuntimeConfig !== "undefined") {
    const config = useRuntimeConfig();
    return {
      chainId: config.public.chainId as number,
      chainName: config.public.chainName as string,
      chainCurrencySymbol: config.public.chainCurrencySymbol as string,
      chainRpcUrl: config.public.chainRpcUrl as string,
      chainBlockExplorerUrl: config.public.chainBlockExplorerUrl as string,
      multicall3Address: config.public.multicall3Address as string,
      multicall3BlockCreated: config.public.multicall3BlockCreated as number,
    };
  }

  const chainId = Number.parseInt(process.env.NUXT_PUBLIC_CHAIN_ID || "56", 10);
  return {
    chainId,
    chainName: process.env.NUXT_PUBLIC_CHAIN_NAME || "BSC Mainnet",
    chainCurrencySymbol: process.env.NUXT_PUBLIC_CHAIN_CURRENCY_SYMBOL || "BNB",
    chainRpcUrl: process.env.NUXT_PUBLIC_CHAIN_RPC_URL || "https://bsc-dataseed.binance.org",
    chainBlockExplorerUrl: process.env.NUXT_PUBLIC_CHAIN_BLOCK_EXPLORER_URL || "https://bscscan.com",
    multicall3Address: process.env.NUXT_PUBLIC_MULTICALL3_ADDRESS || CANONICAL_MULTICALL3_ADDRESS,
    multicall3BlockCreated: Number.parseInt(
      process.env.NUXT_PUBLIC_MULTICALL3_BLOCK_CREATED
        || String(chainId === 56 ? BSC_MULTICALL3_BLOCK_CREATED : 0),
      10,
    ),
  };
};

export const getRuntimeChain = (): Chain => createRuntimeChain(getRuntimeChainConfig());

export const toAddEthereumChainParameter = (chain: Chain): AddEthereumChainParameter => ({
  chainId: `0x${chain.id.toString(16)}`,
  chainName: chain.name,
  nativeCurrency: chain.nativeCurrency,
  rpcUrls: [...chain.rpcUrls.default.http],
  blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : undefined,
});
