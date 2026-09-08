import { JsonRpcProvider, Wallet, Transaction, keccak256, type TransactionRequest, type TransactionReceipt } from "ethers";
import { writeFileSync, renameSync, lstatSync, existsSync } from "node:fs";

export interface LaunchJournal {
  fingerprint: string;
  salt: string;
  transactions: Record<string, { raw: string; hash: string }>;
}

export function assertPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error(`${path} must be a regular owner-only file`);
  }
}

export function savePrivateJson(path: string, value: unknown): void {
  if (existsSync(path)) assertPrivateFile(path);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

/** Persist the signed bytes before sending. A retry can only rebroadcast the same transaction. */
export async function sendJournaled(
  name: string,
  request: TransactionRequest,
  wallet: Wallet,
  provider: JsonRpcProvider,
  journal: LaunchJournal,
  persist: () => void,
  confirmations = 3,
): Promise<TransactionReceipt> {
  let entry = journal.transactions[name];
  if (!entry) {
    const latest = await provider.getTransactionCount(wallet.address, "latest");
    const pending = await provider.getTransactionCount(wallet.address, "pending");
    if (latest !== pending) throw new Error("Deployer has pending transactions. Wait before continuing this launch.");
    const gas = await provider.estimateGas({ ...request, from: wallet.address });
    const fees = await provider.getFeeData();
    if (!fees.gasPrice) throw new Error("RPC did not return a gas price");
    const raw = await wallet.signTransaction({
      ...request, chainId: 56, nonce: pending, type: 0,
      gasLimit: gas * 130n / 100n, gasPrice: fees.gasPrice,
    });
    entry = { raw, hash: keccak256(raw) };
    journal.transactions[name] = entry;
    persist();
  }
  const signed = Transaction.from(entry.raw);
  if (keccak256(entry.raw) !== entry.hash || signed.from !== wallet.address || signed.chainId !== 56n
    || (signed.to || "").toLowerCase() !== String(request.to || "").toLowerCase()
    || signed.data !== (request.data || "0x") || signed.value !== BigInt(String(request.value || 0))) {
    throw new Error(`Saved transaction does not match launch step ${name}`);
  }
  let receipt = await provider.getTransactionReceipt(entry.hash);
  if (!receipt) {
    if (!await provider.getTransaction(entry.hash)) {
      // Never replace an ambiguous transaction with a new nonce or new salt.
      if (await provider.getTransactionCount(wallet.address, "latest") > signed.nonce) {
        throw new Error(`Nonce was consumed by another transaction at step ${name}; manual reconciliation required`);
      }
      await provider.broadcastTransaction(entry.raw);
    }
    receipt = await provider.waitForTransaction(entry.hash, confirmations, 180_000);
  } else if (await receipt.confirmations() < confirmations) {
    receipt = await provider.waitForTransaction(entry.hash, confirmations, 180_000);
  }
  if (!receipt || receipt.status !== 1) throw new Error(`Step ${name} is pending or reverted. Journal preserved; do not delete it.`);
  console.log(`${name}: confirmed ${receipt.hash}`);
  return receipt;
}
