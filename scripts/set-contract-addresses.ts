#!/usr/bin/env bun

import {
  chmodSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { getAddress, isAddress } from "viem";

const ADDRESS_KEYS = {
  TOKEN_ADDRESS: "token",
  NUXT_PUBLIC_TOKEN_ADDRESS: "token",
  LOTTERY_ADDRESS: "lottery",
  NUXT_PUBLIC_LOTTERY_ADDRESS: "lottery",
} as const;

export interface ContractAddressConfig {
  token: string;
  lottery: string;
  surrealDatabase?: string;
}

function normalizeAddress(value: string, label: string): string {
  if (!isAddress(value)) throw new Error(`${label} must be a 20-byte EVM address`);
  return getAddress(value);
}

function replaceEnvValue(document: string, key: string, value: string): string {
  const linePattern = new RegExp(`^${key}=.*$`, "gm");
  const matches = document.match(linePattern) ?? [];

  if (matches.length > 1) throw new Error(`${key} appears more than once`);
  if (matches.length === 1) return document.replace(linePattern, `${key}="${value}"`);

  const separator = document.length === 0 || document.endsWith("\n") ? "" : "\n";
  return `${document}${separator}${key}="${value}"\n`;
}

export function updateContractAddressDocument(
  document: string,
  config: ContractAddressConfig,
): { document: string; token: string; lottery: string } {
  const token = normalizeAddress(config.token, "token address");
  const lottery = normalizeAddress(config.lottery, "lottery address");
  let updated = document;

  for (const [key, source] of Object.entries(ADDRESS_KEYS)) {
    updated = replaceEnvValue(updated, key, source === "token" ? token : lottery);
  }

  if (config.surrealDatabase !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/.test(config.surrealDatabase)) {
      throw new Error("SurrealDB database name may contain only letters, numbers, underscores, and hyphens");
    }
    updated = replaceEnvValue(updated, "SURREAL_DB", config.surrealDatabase);
  }

  return { document: updated, token, lottery };
}

export function updateContractAddressFile(path: string, config: ContractAddressConfig) {
  const metadata = lstatSync(path);
  if (!metadata.isFile()) throw new Error(`${path} must be a regular file`);

  const permissions = metadata.mode & 0o777;
  if (permissions !== 0o600 && permissions !== 0o400) {
    throw new Error(`${path} must be owner-only (chmod 600 or 400)`);
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error(`${path} must be owned by the current user`);
  }

  const current = readFileSync(path, "utf8");
  const result = updateContractAddressDocument(current, config);
  const temporary = join(dirname(path), `.${basename(path)}.contract-addresses.${process.pid}.tmp`);

  try {
    writeFileSync(temporary, result.document, { encoding: "utf8", mode: permissions });
    chmodSync(temporary, permissions);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }

  return result;
}

interface CliOptions {
  envFile: string;
  token: string;
  lottery: string;
  surrealDatabase?: string;
}

function parseCliOptions(args: string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith("--") || value === undefined) {
      throw new Error("usage: set-contract-addresses.ts --token ADDRESS --lottery ADDRESS [--env-file PATH] [--surreal-db NAME]");
    }
    values.set(option, value);
  }

  const token = values.get("--token");
  const lottery = values.get("--lottery");
  if (!token || !lottery) throw new Error("--token and --lottery are required");

  return {
    envFile: values.get("--env-file") ?? ".env",
    token,
    lottery,
    surrealDatabase: values.get("--surreal-db"),
  };
}

if (import.meta.main) {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const result = updateContractAddressFile(options.envFile, options);
    console.log(`updated ${options.envFile}`);
    console.log(`token=${result.token}`);
    console.log(`lottery=${result.lottery}`);
    if (options.surrealDatabase) console.log(`surreal_db=${options.surrealDatabase}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
