// https://nuxt.com/docs/api/configuration/nuxt-config
const useDokployCron = process.env.USE_DOKPLOY_CRON === "1";
const publicChainId = parseInt(process.env.NUXT_PUBLIC_CHAIN_ID || "56", 10);
const defaultMulticall3BlockCreated = publicChainId === 56 ? 15_921_452 : 0;

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: process.env.NODE_ENV === "development" },
  devServer: { port: 7341 },
  buildDir: ".nuxt",
  modules: ["@nuxt/ui", "@nuxt/fonts"],

  // Runtime configuration from .env
  runtimeConfig: {
    rpcUrl: process.env.RPC_URL || "",
    tokenAddress: process.env.TOKEN_ADDRESS || "",
    lotteryAddress: process.env.LOTTERY_ADDRESS || "",
    vaultAddress: process.env.VAULT_ADDRESS || "",

    // Public keys (available on client)
    public: {
      chainId: publicChainId,
      chainName: process.env.NUXT_PUBLIC_CHAIN_NAME || "BSC Mainnet",
      chainCurrencySymbol: process.env.NUXT_PUBLIC_CHAIN_CURRENCY_SYMBOL || "BNB",
      chainRpcUrl: process.env.NUXT_PUBLIC_CHAIN_RPC_URL || "https://bsc-dataseed.binance.org",
      chainBlockExplorerUrl: process.env.NUXT_PUBLIC_CHAIN_BLOCK_EXPLORER_URL || "https://bscscan.com",
      multicall3Address:
        process.env.NUXT_PUBLIC_MULTICALL3_ADDRESS || "0xcA11bde05977b3631167028862bE2a173976CA11",
      multicall3BlockCreated: parseInt(
        process.env.NUXT_PUBLIC_MULTICALL3_BLOCK_CREATED || String(defaultMulticall3BlockCreated),
        10,
      ),
      tokenAddress: process.env.NUXT_PUBLIC_TOKEN_ADDRESS || process.env.TOKEN_ADDRESS || "",
      lotteryAddress: process.env.NUXT_PUBLIC_LOTTERY_ADDRESS || process.env.LOTTERY_ADDRESS || "",
      vaultAddress: process.env.NUXT_PUBLIC_VAULT_ADDRESS || process.env.VAULT_ADDRESS || "",
      environment: process.env.NUXT_PUBLIC_ENVIRONMENT || "development",
      appMode: process.env.NUXT_PUBLIC_APP_MODE || "live",
      screenMode: process.env.NUXT_PUBLIC_SCREEN_MODE || "live",
    },
  },

  // Nitro server configuration
  nitro: {
    experimental: {
      tasks: true,
    },
    preset: "bun",
    ...(useDokployCron
      ? {}
      : {
          scheduledTasks: {
            // Run settlement check every minute
            "* * * * *": ["settle", "sync-live-activity"],
            // Cache tickets every 10 minutes for display
            "*/10 * * * *": ["cache-tickets"],
          },
        }),
    esbuild: {
      options: {
        target: "esnext",
      },
    },
  },

  app: {
    head: {
      title: "DoubleBall Lottery - 双色球彩票",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content:
            "DoubleBall Lottery - A decentralized blockchain-based lottery system on BSC. Win big with transparent, fair draws powered by Chainlink VRF.",
        },
        {
          name: "keywords",
          content: "lottery, blockchain, BSC, DoubleBall, 双色球, cryptocurrency, Chainlink VRF, decentralized lottery",
        },
        { name: "author", content: "DoubleBall Lottery" },
        { property: "og:title", content: "DoubleBall Lottery - 双色球彩票" },
        {
          property: "og:description",
          content: "Join the decentralized lottery revolution! Fair, transparent draws on BSC blockchain.",
        },
        { property: "og:type", content: "website" },
        { property: "og:image", content: "/banner.jpg" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "DoubleBall Lottery - 双色球彩票" },
        {
          name: "twitter:description",
          content: "Join the decentralized lottery revolution! Fair, transparent draws on BSC blockchain.",
        },
        { name: "twitter:image", content: "/banner.jpg" },
      ],
      link: [
        { rel: "icon", type: "image/png", href: "/logo.png" },
        { rel: "apple-touch-icon", href: "/logo.png" },
      ],
    },
  },

  // Configure Nuxt Fonts - Premium typography
  fonts: {
    families: [
      {
        name: "Playfair Display",
        provider: "google",
        weights: [400, 700],
      },
      {
        name: "Bebas Neue",
        provider: "google",
        weights: [400],
      },
    ],
    defaults: {
      weights: [400, 700],
      fallbacks: {
        "sans-serif": ["system-ui", "sans-serif"],
        serif: ["Playfair Display"],
      },
    },
  },
  // Ensure composables are auto-imported
  imports: {
    dirs: ["composables", "config"],
  },

  // Handle SSR properly for Web3
  ssr: true,

  // TypeScript configuration
  typescript: {
    tsConfig: {
      compilerOptions: {
        resolveJsonModule: true,
        esModuleInterop: true,
        types: ["bun"],
      },
    },
  },

  // Vite configuration for client-side Web3 libraries
  vite: {
    optimizeDeps: {
      exclude: ["viem"],
    },
  },
  css: ["@/assets/main.css"],
});
