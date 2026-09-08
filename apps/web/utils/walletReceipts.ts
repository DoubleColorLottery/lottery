import type { Hash, TransactionReceipt } from "viem";

export class TransactionRevertedError extends Error {
  constructor(readonly hash: Hash, operation = "Transaction") {
    super(`${operation} reverted on-chain (${hash})`);
    this.name = "TransactionRevertedError";
  }
}

export const assertSuccessfulReceipt = <T extends Pick<TransactionReceipt, "status" | "transactionHash">>(
  receipt: T,
  operation?: string,
): T => {
  if (receipt.status !== "success") throw new TransactionRevertedError(receipt.transactionHash, operation);
  return receipt;
};

export const waitForSuccessfulReceipt = async <T extends TransactionReceipt>(
  client: { waitForTransactionReceipt(args: { hash: Hash }): Promise<T> },
  hash: Hash,
  operation?: string,
): Promise<T> => assertSuccessfulReceipt(await client.waitForTransactionReceipt({ hash }), operation);
