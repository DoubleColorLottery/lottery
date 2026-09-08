import { describe, expect, test } from "bun:test";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  TICKET_COST,
  applyTransferBalances,
  assertEligibilitySnapshot,
  buildEligibilityEntries,
  hashEligibilityManifest,
  replayTransferBalances,
  signEligibilityCertificate,
  summarizeEligibility,
} from "../../server/utils/eligibility";

const ALICE = "0x1111111111111111111111111111111111111111" as Address;
const BOB = "0x2222222222222222222222222222222222222222" as Address;
const POOL = "0x3333333333333333333333333333333333333333" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

describe("Flap eligibility manifests", () => {
  test("replays mint, taxed transfer, and burn logs at the cutoff", () => {
    const balances = replayTransferBalances([
      { blockNumber: 3n, transactionIndex: 0, logIndex: 0, args: { from: BOB, to: ZERO, value: 100n } },
      { blockNumber: 1n, transactionIndex: 0, logIndex: 0, args: { from: ZERO, to: ALICE, value: 10_000n } },
      { blockNumber: 2n, transactionIndex: 0, logIndex: 1, args: { from: ALICE, to: POOL, value: 100n } },
      { blockNumber: 2n, transactionIndex: 0, logIndex: 0, args: { from: ALICE, to: BOB, value: 900n } },
    ]);

    expect(balances.get(ALICE)).toBe(9_000n);
    expect(balances.get(BOB)).toBe(800n);
    expect(balances.get(POOL)).toBe(100n);
  });

  test("advances a persisted balance index with only new Transfer logs", () => {
    const balances = applyTransferBalances(new Map<Address, bigint>([
      [ALICE, 10_000n],
      [BOB, 500n],
    ]), [
      { blockNumber: 11n, transactionIndex: 0, logIndex: 0, args: { from: ALICE, to: BOB, value: 1_000n } },
      { blockNumber: 12n, transactionIndex: 0, logIndex: 0, args: { from: ZERO, to: POOL, value: 250n } },
    ]);

    expect(balances.get(ALICE)).toBe(9_000n);
    expect(balances.get(BOB)).toBe(1_500n);
    expect(balances.get(POOL)).toBe(250n);
  });

  test("derives ticket counts, exclusions, a stable order, and manifest hash", () => {
    const balances = new Map<Address, bigint>([
      [BOB, TICKET_COST * 2n + 10n],
      [POOL, TICKET_COST * 100n],
      [ALICE, TICKET_COST],
    ]);
    const entries = buildEligibilityEntries(balances, new Set([POOL]));

    expect(entries.map((entry) => entry.account)).toEqual([ALICE, BOB]);
    expect(entries.map((entry) => entry.ticketCount)).toEqual([1n, 2n]);
    expect(summarizeEligibility(entries)).toEqual({ eligibleHolderCount: 2n, totalEligibleTickets: 3n });
    expect(hashEligibilityManifest(entries)).toBe(hashEligibilityManifest([...entries].reverse().reverse()));
  });

  test("rejects an incomplete or inconsistent replay", () => {
    expect(() => replayTransferBalances([
      { blockNumber: 1n, logIndex: 0, args: { from: ALICE, to: BOB, value: 1n } },
    ])).toThrow("underflow");
    expect(() => replayTransferBalances([
      { blockNumber: 1n, logIndex: 0, args: { from: ALICE, to: BOB } },
    ])).toThrow("missing decoded arguments");
    expect(() => hashEligibilityManifest([])).toThrow("cannot be empty");
  });

  test("signs the contract EIP-712 claim domain", async () => {
    const privateKey = `0x${"12".repeat(32)}` as Hex;
    const signer = privateKeyToAccount(privateKey);
    const lotteryAddress = "0x4444444444444444444444444444444444444444" as Address;
    const eligibilitySetId = `0x${"ab".repeat(32)}` as Hex;
    const certificate = await signEligibilityCertificate({
      privateKey,
      chainId: 56,
      lotteryAddress,
      roundId: 7n,
      eligibilitySetId,
      entry: { account: ALICE, eligibleBalance: TICKET_COST * 3n, ticketCount: 3n },
    });

    const recovered = await recoverTypedDataAddress({
      domain: { name: "FlapDoubleBallLottery", version: "1", chainId: 56, verifyingContract: lotteryAddress },
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

    expect(recovered).toBe(signer.address);
    expect(certificate.ticketCount).toBe(3n);
  });

  test("accepts only a complete signed snapshot matching the frozen round", async () => {
    const privateKey = `0x${"12".repeat(32)}` as Hex;
    const signer = privateKeyToAccount(privateKey);
    const lotteryAddress = "0x4444444444444444444444444444444444444444" as Address;
    const tokenAddress = "0x5555555555555555555555555555555555555555" as Address;
    const eligibilitySetId = `0x${"ab".repeat(32)}` as Hex;
    const entries = [
      { account: ALICE, eligibleBalance: TICKET_COST, ticketCount: 1n },
      { account: BOB, eligibleBalance: TICKET_COST * 2n, ticketCount: 2n },
    ];
    const certificates = await Promise.all(entries.map((entry) => signEligibilityCertificate({
      privateKey,
      chainId: 56,
      lotteryAddress,
      roundId: 7n,
      eligibilitySetId,
      entry,
    })));
    const round = {
      id: 7n,
      eligibilityBlock: 100n,
      eligibilityBlockHash: `0x${"cd".repeat(32)}` as Hex,
      eligibilitySigner: signer.address,
      eligibilitySetId,
      manifestHash: hashEligibilityManifest(entries),
      eligibleHolderCount: 2n,
      totalEligibleTickets: 3n,
    };
    const manifest = {
      lottery: lotteryAddress,
      token: tokenAddress,
      roundId: 7,
      eligibilityBlock: 100,
      eligibilityBlockHash: round.eligibilityBlockHash,
      manifestHash: round.manifestHash,
      eligibilitySetId,
      eligibleHolderCount: 2,
      totalEligibleTickets: "3",
      status: "drawing" as const,
    };
    const storedCertificates = certificates.map((certificate) => ({
      lottery: lotteryAddress,
      roundId: 7,
      account: certificate.account,
      eligibleBalance: certificate.eligibleBalance.toString(),
      ticketCount: certificate.ticketCount.toString(),
      eligibilitySetId,
      signature: certificate.signature,
    }));

    await expect(assertEligibilitySnapshot({
      chainId: 56,
      lotteryAddress,
      tokenAddress,
      round,
      manifest,
      certificates: storedCertificates,
    })).resolves.toEqual(certificates);

    await expect(assertEligibilitySnapshot({
      chainId: 56,
      lotteryAddress,
      tokenAddress,
      round,
      manifest,
      certificates: storedCertificates.map((certificate, index) =>
        index === 0 ? { ...certificate, ticketCount: "2" } : certificate
      ),
    })).rejects.toThrow("ticket count");

    await expect(assertEligibilitySnapshot({
      chainId: 56,
      lotteryAddress,
      tokenAddress,
      round,
      manifest,
      certificates: storedCertificates.map((certificate, index) =>
        index === 0 ? { ...certificate, signature: `0x${"00".repeat(65)}` as Hex } : certificate
      ),
    })).rejects.toThrow("signature");
  });
});
