import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

interface Asset {
  path: string;
  size: number;
}

interface Budget {
  label: string;
  actual: number;
  limit: number;
}

const repositoryRoot = resolve(import.meta.dir, "..");
const publicOutput = join(repositoryRoot, "apps/web/.output/public");

if (!existsSync(publicOutput)) {
  throw new Error("Web output is missing. Run `bun run build:web` before checking performance budgets.");
}

function collectFiles(directory: string): Asset[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [{ path, size: statSync(path).size }];
  });
}

function totalSize(assets: readonly Asset[], extensions?: readonly string[]): number {
  return assets
    .filter((asset) => !extensions || extensions.includes(extname(asset.path)))
    .reduce((total, asset) => total + asset.size, 0);
}

function largestSize(assets: readonly Asset[], extension: string): number {
  return Math.max(0, ...assets.filter((asset) => extname(asset.path) === extension).map((asset) => asset.size));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

const assets = collectFiles(publicOutput);
const budgets: Budget[] = [
  {
    label: "largest JavaScript bundle",
    actual: largestSize(assets, ".js"),
    limit: 512 * 1024,
  },
  {
    label: "all stylesheets",
    actual: totalSize(assets, [".css"]),
    limit: 128 * 1024,
  },
  {
    label: "all webfonts",
    actual: totalSize(assets, [".woff", ".woff2"]),
    limit: 512 * 1024,
  },
  {
    label: "browser payload",
    actual: totalSize(assets),
    limit: 4 * 1024 * 1024,
  },
];

for (const budget of budgets) {
  console.log(`${budget.label}: ${formatBytes(budget.actual)} / ${formatBytes(budget.limit)}`);
}

const oversizedStaticAssets = assets.filter((asset) => {
  const outputPath = relative(publicOutput, asset.path);
  return !outputPath.startsWith("_nuxt/") && !outputPath.startsWith("_fonts/") && asset.size > 800 * 1024;
});

for (const asset of oversizedStaticAssets) {
  console.error(`static asset exceeds 800 KiB: ${relative(publicOutput, asset.path)} (${formatBytes(asset.size)})`);
}

const exceededBudgets = budgets.filter((budget) => budget.actual > budget.limit);
if (exceededBudgets.length > 0 || oversizedStaticAssets.length > 0) {
  process.exitCode = 1;
}
