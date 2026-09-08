import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseEther, type Address, type Hex } from "viem";
import {
  ELIGIBILITY_PRIVATE_KEY,
  SETTLER_PRIVATE_KEY,
  deployFlapSettlementFixture,
  startAnvil,
  type AnvilService,
} from "../helpers/flapSettlementE2EHarness";
import { startSurrealDb, type SurrealService } from "../helpers/surrealE2EHarness";
import {
  TICKET_COST,
  hashEligibilityManifest,
  signEligibilityCertificate,
} from "../../server/utils/eligibility";

const ENV_KEYS = [
  "SURREAL_URL",
  "SURREAL_USER",
  "SURREAL_PASS",
  "SURREAL_NS",
  "SURREAL_DB",
  "RPC_URL",
  "CHAIN_ID",
  "TOKEN_ADDRESS",
  "LOTTERY_ADDRESS",
  "BSC_MAINNET_PRIVATE_KEY",
  "ELIGIBILITY_SIGNER_PRIVATE_KEY",
  "TOKEN_DEPLOYMENT_BLOCK",
  "LOTTERY_DEPLOYMENT_BLOCK",
  "TRANSACTION_CONFIRMATIONS",
  "MULTICALL3_ADDRESS",
  "MULTICALL3_BLOCK_CREATED",
] as const;

let anvil: AnvilService;
let surreal: SurrealService;
let previousEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;
let fixture: Awaited<ReturnType<typeof deployFlapSettlementFixture>>;
let surrealModule: typeof import("../../server/utils/surrealdb");
let contractModule: typeof import("../../server/utils/contract");
let settlementModule: typeof import("../../server/utils/settlement");

describe("Flap settlement E2E", () => {
  beforeAll(async () => {
    [anvil, surreal] = await Promise.all([startAnvil(), startSurrealDb()]);
    fixture = await deployFlapSettlementFixture(anvil.url);
    previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as typeof previousEnv;
    Object.assign(process.env, {
      SURREAL_URL: surreal.url,
      SURREAL_USER: "root",
      SURREAL_PASS: "root",
      SURREAL_NS: "lottery_flap_e2e",
      SURREAL_DB: "settlement",
      RPC_URL: anvil.url,
      CHAIN_ID: "31337",
      TOKEN_ADDRESS: fixture.tokenAddress,
      LOTTERY_ADDRESS: fixture.lotteryAddress,
      BSC_MAINNET_PRIVATE_KEY: SETTLER_PRIVATE_KEY,
      ELIGIBILITY_SIGNER_PRIVATE_KEY: ELIGIBILITY_PRIVATE_KEY,
      TOKEN_DEPLOYMENT_BLOCK: "1",
      LOTTERY_DEPLOYMENT_BLOCK: "1",
      TRANSACTION_CONFIRMATIONS: "1",
      MULTICALL3_ADDRESS: fixture.multicallAddress,
      MULTICALL3_BLOCK_CREATED: "1",
    });

    surrealModule = await import("../../server/utils/surrealdb");
    contractModule = await import("../../server/utils/contract");
    settlementModule = await import("../../server/utils/settlement");
    await surrealModule.initSurrealDB();
  }, 120_000);

  afterAll(async () => {
    await surrealModule?.closeDB();
    await Promise.all([anvil?.stop(), surreal?.stop()]);
    for (const key of ENV_KEYS) {
      const value = previousEnv?.[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, 60_000);

  test("live holder counts follow transfers without publishing an index or starting a round", async () => {
    const service = await import("../../server/utils/eligibility-service");
    await fixture.client.request({ method: "anvil_mine", params: ["0x20"] });
    const beforeIndex = await surrealModule.getEligibilityBalanceIndex(fixture.tokenAddress);
    const before = await service.getLiveHolderCounts();
    expect(before.eligibleHolders).toBe(1n);
    const hash = await fixture.wallet.writeContract({
      address: fixture.tokenAddress,
      abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "transfer",
      args: ["0x1111111111111111111111111111111111111111", TICKET_COST],
    });
    await fixture.client.waitForTransactionReceipt({ hash });
    await fixture.client.request({ method: "anvil_mine", params: ["0x20"] });
    const after = await service.getLiveHolderCounts();
    expect(after.eligibleHolders).toBe(2n);
    expect(after.tokenHolders).toBe(2n);
    expect(await surrealModule.getEligibilityBalanceIndex(fixture.tokenAddress)).toEqual(beforeIndex);
    expect(await contractModule.getCurrentRoundId()).toBe(0n);
  });

  test("validates the frozen manifest and publishes the mined settlement projection", async () => {
    const holder = fixture.account.address;
    const entries = [{ account: holder, eligibleBalance: TICKET_COST, ticketCount: 1n }];
    const manifestHash = hashEligibilityManifest(entries);

    const writeLottery = async (functionName: string, args: readonly unknown[] = [], value?: bigint) => {
      const hash = await fixture.wallet.writeContract({
        address: fixture.lotteryAddress,
        abi: fixture.lotteryAbi,
        functionName,
        args,
        value,
      });
      await fixture.client.waitForTransactionReceipt({ hash });
    };

    await writeLottery("setLotteryEnabled", [true]);
    await writeLottery("setLotteryInterval", [200n]);
    await writeLottery("changeTicketNumbers", [0n, [1, 2, 3, 4, 5, 6], 7]);
    await writeLottery("fundPot", [], parseEther("10"));
    await fixture.client.request({ method: "anvil_mine", params: ["0xdc"] });

    const latestBlock = await fixture.client.getBlockNumber({ cacheTime: 0 });
    const eligibilityBlock = latestBlock - 15n;
    const cutoff = await fixture.client.getBlock({ blockNumber: eligibilityBlock });
    if (!cutoff.hash) throw new Error("Eligibility cutoff has no hash");
    await writeLottery("prepareRound", [eligibilityBlock, cutoff.hash, manifestHash, 1n, 1n]);

    const preparedRound = await fixture.client.readContract({
      address: fixture.lotteryAddress,
      abi: fixture.lotteryAbi,
      functionName: "getRound",
      args: [1n],
    }) as { eligibilitySetId: Hex };
    const certificate = await signEligibilityCertificate({
      privateKey: ELIGIBILITY_PRIVATE_KEY,
      chainId: 31337,
      lotteryAddress: fixture.lotteryAddress,
      roundId: 1n,
      eligibilitySetId: preparedRound.eligibilitySetId,
      entry: entries[0]!,
    });
    await surrealModule.saveEligibilityManifestDraft({
      lottery: fixture.lotteryAddress,
      token: fixture.tokenAddress,
      roundId: 1,
      eligibilityBlock: Number(eligibilityBlock),
      eligibilityBlockHash: cutoff.hash,
      manifestHash,
      eligibleHolderCount: 1,
      totalEligibleTickets: "1",
    }, entries);
    await surrealModule.finalizeEligibilityManifest(
      fixture.lotteryAddress,
      1,
      preparedRound.eligibilitySetId,
      [{ account: holder, signature: certificate.signature }],
    );
    await surrealModule.markEligibilityManifestDrawing(fixture.lotteryAddress, 1);

    await writeLottery("requestDraw", [1n]);
    const drawingRound = await fixture.client.readContract({
      address: fixture.lotteryAddress,
      abi: fixture.lotteryAbi,
      functionName: "getRound",
      args: [1n],
    }) as { requestId: bigint };
    const fulfillHash = await fixture.wallet.writeContract({
      address: fixture.vrfAddress,
      abi: fixture.vrfAbi,
      functionName: "fulfill",
      args: [fixture.lotteryAddress, drawingRound.requestId, [0n, 1n, 2n, 3n, 4n, 5n, 6n]],
    });
    await fixture.client.waitForTransactionReceipt({ hash: fulfillHash });

    const preSettlementSnapshot = await fixture.client.request({ method: "evm_snapshot" });
    const drawnRound = await contractModule.getRound(1n);
    const result = await settlementModule.settleRound(1, drawnRound);
    expect(result).toMatchObject({ success: true, action: "settled", roundId: 1, totalWinners: 1 });
    expect((await contractModule.getRound(1n)).tierWinnerCounts[0]).toBe(1n);
    expect(await surrealModule.getSettlement(1)).toMatchObject({
      roundId: 1,
      totalWinners: 1,
      tierWinnerCounts: ["1", "0", "0", "0", "0", "0"],
      settlementBlockHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect((await surrealModule.getUserWinsPaginated(holder as Address, 1, 10, 0)).total).toBe(1);

    expect(await fixture.client.request({ method: "evm_revert", params: [preSettlementSnapshot] })).toBe(true);
    expect((await contractModule.getRound(1n)).settled).toBe(false);
    const recovered = await settlementModule.settleRound(1, await contractModule.getRound(1n));
    expect(recovered).toMatchObject({ success: true, action: "settled", roundId: 1, totalWinners: 1 });
    expect((await contractModule.getRound(1n)).settled).toBe(true);
    expect(await surrealModule.getSettlement(1)).toMatchObject({ roundId: 1, totalWinners: 1 });
  }, 120_000);
});
