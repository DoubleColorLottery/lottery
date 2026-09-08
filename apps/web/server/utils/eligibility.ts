import {
  concat,
  encodePacked,
  getAddress,
  keccak256,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const TICKET_COST = 2_000n * 10n ** 18n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export interface TransferLogLike {
  blockNumber: bigint | null;
  transactionIndex?: number | null;
  logIndex: number | null;
  args: {
    from?: Address;
    to?: Address;
    value?: bigint;
  };
}

export interface EligibilityEntry {
  account: Address;
  eligibleBalance: bigint;
  ticketCount: bigint;
}

export interface EligibilityClaim {
  roundId: bigint;
  account: Address;
  eligibleBalance: bigint;
  eligibilitySetId: Hex;
}

export interface EligibilityCertificate extends EligibilityClaim {
  ticketCount: bigint;
  signature: Hex;
}

export interface FrozenEligibilityRound {
  id: bigint;
  eligibilityBlock: bigint;
  eligibilityBlockHash: Hex;
  eligibilitySigner: Address;
  eligibilitySetId: Hex;
  manifestHash: Hex;
  eligibleHolderCount: bigint;
  totalEligibleTickets: bigint;
}

export interface StoredEligibilityManifest {
  lottery: string;
  token: string;
  roundId: number;
  eligibilityBlock: number;
  eligibilityBlockHash: string;
  manifestHash: string;
  eligibilitySetId?: string;
  eligibleHolderCount: number;
  totalEligibleTickets: string;
  status: string;
}

export interface StoredEligibilityCertificate {
  lottery: string;
  roundId: number;
  account: string;
  eligibleBalance: string;
  ticketCount: string;
  eligibilitySetId?: string;
  signature?: string;
}

export interface EligibilitySnapshotInput {
  chainId: number;
  lotteryAddress: Address;
  tokenAddress: Address;
  round: FrozenEligibilityRound;
  manifest: StoredEligibilityManifest;
  certificates: readonly StoredEligibilityCertificate[];
}

function compareLogs(left: TransferLogLike, right: TransferLogLike): number {
  const leftBlock = left.blockNumber ?? -1n;
  const rightBlock = right.blockNumber ?? -1n;
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;

  const leftTransaction = left.transactionIndex ?? -1;
  const rightTransaction = right.transactionIndex ?? -1;
  if (leftTransaction !== rightTransaction) return leftTransaction - rightTransaction;
  return (left.logIndex ?? -1) - (right.logIndex ?? -1);
}

/** Replays standard ERC-20 Transfer logs into the exact balance state at a cutoff block. */
export function replayTransferBalances(logs: readonly TransferLogLike[]): Map<Address, bigint> {
  return applyTransferBalances(new Map(), logs);
}

/** Applies ordered Transfer logs to a prior indexed balance state. */
export function applyTransferBalances(
  initialBalances: ReadonlyMap<Address, bigint>,
  logs: readonly TransferLogLike[],
): Map<Address, bigint> {
  const balances = new Map<Address, bigint>(initialBalances);

  for (const log of [...logs].sort(compareLogs)) {
    const { from, to, value } = log.args;
    if (!from || !to || value === undefined) throw new Error("Transfer log is missing decoded arguments");
    if (value < 0n) throw new Error("Transfer value cannot be negative");

    const normalizedFrom = getAddress(from);
    const normalizedTo = getAddress(to);

    if (normalizedFrom !== ZERO_ADDRESS) {
      const nextBalance = (balances.get(normalizedFrom) ?? 0n) - value;
      if (nextBalance < 0n) {
        throw new Error(`Transfer replay underflow for ${normalizedFrom}`);
      }
      if (nextBalance === 0n) balances.delete(normalizedFrom);
      else balances.set(normalizedFrom, nextBalance);
    }

    if (normalizedTo !== ZERO_ADDRESS) {
      balances.set(normalizedTo, (balances.get(normalizedTo) ?? 0n) + value);
    }
  }

  return balances;
}

export function buildEligibilityEntries(
  balances: ReadonlyMap<Address, bigint>,
  excludedAddresses: ReadonlySet<string>,
): EligibilityEntry[] {
  const normalizedExclusions = new Set([...excludedAddresses].map((address) => address.toLowerCase()));

  return [...balances.entries()]
    .filter(([account, balance]) => balance >= TICKET_COST && !normalizedExclusions.has(account.toLowerCase()))
    .map(([account, eligibleBalance]) => ({
      account: getAddress(account),
      eligibleBalance,
      ticketCount: eligibleBalance / TICKET_COST,
    }))
    .sort((left, right) => left.account.toLowerCase().localeCompare(right.account.toLowerCase()));
}

/** Hashes a sorted list of address/balance/ticket leaves for an externally reproducible audit commitment. */
export function hashEligibilityManifest(entries: readonly EligibilityEntry[]): Hex {
  if (entries.length === 0) throw new Error("Eligibility manifest cannot be empty");
  const leaves = entries.map((entry) =>
    keccak256(
      encodePacked(
        ["address", "uint256", "uint256"],
        [entry.account, entry.eligibleBalance, entry.ticketCount],
      ),
    ),
  );
  return keccak256(concat(leaves));
}

export function summarizeEligibility(entries: readonly EligibilityEntry[]): {
  eligibleHolderCount: bigint;
  totalEligibleTickets: bigint;
} {
  return {
    eligibleHolderCount: BigInt(entries.length),
    totalEligibleTickets: entries.reduce((total, entry) => total + entry.ticketCount, 0n),
  };
}

function assertEqual(actual: string | bigint | number | undefined, expected: string | bigint | number, label: string) {
  if (String(actual).toLowerCase() !== String(expected).toLowerCase()) {
    throw new Error(`Eligibility snapshot ${label} does not match the frozen round`);
  }
}

/** Validates and normalizes the exact signed snapshot that settlement will consume. */
export async function assertEligibilitySnapshot(
  input: EligibilitySnapshotInput,
  checkpoint?: (label: string) => Promise<void>,
): Promise<EligibilityCertificate[]> {
  const { manifest, round } = input;
  if (manifest.status !== "signed" && manifest.status !== "drawing") {
    throw new Error(`Eligibility snapshot has invalid manifest status ${manifest.status}`);
  }

  assertEqual(manifest.lottery, input.lotteryAddress, "lottery");
  assertEqual(manifest.token, input.tokenAddress, "token");
  assertEqual(manifest.roundId, round.id, "round ID");
  assertEqual(manifest.eligibilityBlock, round.eligibilityBlock, "block");
  assertEqual(manifest.eligibilityBlockHash, round.eligibilityBlockHash, "block hash");
  assertEqual(manifest.manifestHash, round.manifestHash, "manifest hash");
  assertEqual(manifest.eligibilitySetId, round.eligibilitySetId, "eligibility set ID");
  assertEqual(manifest.eligibleHolderCount, round.eligibleHolderCount, "holder count");
  assertEqual(manifest.totalEligibleTickets, round.totalEligibleTickets, "ticket total");

  if (BigInt(input.certificates.length) !== round.eligibleHolderCount) {
    throw new Error(
      `Eligibility snapshot holder count mismatch: expected ${round.eligibleHolderCount}, got ${input.certificates.length}`,
    );
  }

  const certificates: EligibilityCertificate[] = [];
  let previousAccount = "";
  for (const stored of input.certificates) {
    assertEqual(stored.lottery, input.lotteryAddress, "certificate lottery");
    assertEqual(stored.roundId, round.id, "certificate round ID");
    assertEqual(stored.eligibilitySetId, round.eligibilitySetId, "certificate eligibility set ID");
    if (!stored.signature) throw new Error(`Eligibility snapshot certificate ${stored.account} has no signature`);

    let account: Address;
    let eligibleBalance: bigint;
    let ticketCount: bigint;
    try {
      account = getAddress(stored.account);
      eligibleBalance = BigInt(stored.eligibleBalance);
      ticketCount = BigInt(stored.ticketCount);
    } catch {
      throw new Error(`Eligibility snapshot certificate ${stored.account} has invalid numeric or address data`);
    }
    if (ticketCount === 0n || eligibleBalance / TICKET_COST !== ticketCount) {
      throw new Error(`Eligibility snapshot certificate ${account} ticket count does not match eligible balance`);
    }
    const accountKey = account.toLowerCase();
    if (previousAccount && previousAccount >= accountKey) {
      throw new Error("Eligibility snapshot certificates are duplicated or not canonically ordered");
    }
    previousAccount = accountKey;
    certificates.push({
      roundId: round.id,
      account,
      eligibleBalance,
      eligibilitySetId: round.eligibilitySetId,
      ticketCount,
      signature: stored.signature as Hex,
    });
  }

  const summary = summarizeEligibility(certificates);
  if (summary.totalEligibleTickets !== round.totalEligibleTickets) {
    throw new Error(
      `Eligibility snapshot ticket total mismatch: expected ${round.totalEligibleTickets}, got ${summary.totalEligibleTickets}`,
    );
  }
  if (hashEligibilityManifest(certificates).toLowerCase() !== round.manifestHash.toLowerCase()) {
    throw new Error("Eligibility snapshot manifest hash does not match the frozen round");
  }

  for (let index = 0; index < certificates.length; index++) {
    if (index % 64 === 0) await checkpoint?.("while verifying eligibility signatures");
    const certificate = certificates[index]!;
    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain: {
          name: "FlapDoubleBallLottery",
          version: "1",
          chainId: input.chainId,
          verifyingContract: input.lotteryAddress,
        },
        types: {
          EligibilityClaim: [
            { name: "roundId", type: "uint256" },
            { name: "account", type: "address" },
            { name: "eligibleBalance", type: "uint256" },
            { name: "eligibilitySetId", type: "bytes32" },
          ],
        },
        primaryType: "EligibilityClaim",
        message: certificate,
        signature: certificate.signature,
      });
    } catch {
      throw new Error(`Eligibility snapshot certificate ${certificate.account} has an invalid signature`);
    }
    if (recovered.toLowerCase() !== round.eligibilitySigner.toLowerCase()) {
      throw new Error(`Eligibility snapshot certificate ${certificate.account} has an invalid signature`);
    }
  }

  return certificates;
}

export async function signEligibilityCertificate(args: {
  privateKey: Hex;
  chainId: number;
  lotteryAddress: Address;
  roundId: bigint;
  eligibilitySetId: Hex;
  entry: EligibilityEntry;
}): Promise<EligibilityCertificate> {
  const account = privateKeyToAccount(args.privateKey);
  const claim: EligibilityClaim = {
    roundId: args.roundId,
    account: args.entry.account,
    eligibleBalance: args.entry.eligibleBalance,
    eligibilitySetId: args.eligibilitySetId,
  };
  const signature = await account.signTypedData({
    domain: {
      name: "FlapDoubleBallLottery",
      version: "1",
      chainId: args.chainId,
      verifyingContract: args.lotteryAddress,
    },
    types: {
      EligibilityClaim: [
        { name: "roundId", type: "uint256" },
        { name: "account", type: "address" },
        { name: "eligibleBalance", type: "uint256" },
        { name: "eligibilitySetId", type: "bytes32" },
      ],
    },
    primaryType: "EligibilityClaim",
    message: claim,
  });

  return { ...claim, ticketCount: args.entry.ticketCount, signature };
}
