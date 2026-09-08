import { parseAbiItem } from "viem";
import { LOTTERY_ADDRESS, TOKEN_ADDRESS, publicClient, tokenAbi, taxProcessorAbi } from "../utils/contract";
import { serverConfig } from "../utils/config";

const SETTLED = parseAbiItem("event RoundSettledWithRollover(uint256 indexed roundId, uint256[6] tierWinnerCounts, uint256 totalPot, uint256 stashedPot, uint256 rolloverAmount)");
const FLUSHED = parseAbiItem("event RevenueFlushed(address indexed lottery, uint256 amount)");

export default defineCachedEventHandler(async () => {
  if (serverConfig.lotteryDeploymentBlock <= 0 || !serverConfig.vaultAddress) {
    throw createError({ statusCode: 503, message: "Lottery history is not configured" });
  }
  const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
  let rounds = 0;
  const settledRoundIds: string[] = [];
  let prizesAllocated = 0n;
  let roundPots = 0n;
  let flushed = 0n;
  for (let fromBlock = BigInt(serverConfig.lotteryDeploymentBlock); fromBlock <= blockNumber; fromBlock += 2000n) {
    const toBlock = fromBlock + 1999n < blockNumber ? fromBlock + 1999n : blockNumber;
    const [settlements, transfers] = await Promise.all([
      publicClient.getLogs({ address: LOTTERY_ADDRESS, event: SETTLED, fromBlock, toBlock, strict: true }),
      publicClient.getLogs({ address: serverConfig.vaultAddress, event: FLUSHED, args: { lottery: LOTTERY_ADDRESS }, fromBlock, toBlock, strict: true }),
    ]);
    for (const log of settlements) {
      rounds++;
      settledRoundIds.push(log.args.roundId.toString());
      prizesAllocated += log.args.stashedPot;
      roundPots += log.args.totalPot;
    }
    for (const log of transfers) flushed += log.args.amount;
  }
  const processor = await publicClient.readContract({ address: TOKEN_ADDRESS, abi: tokenAbi, functionName: "taxProcessor", blockNumber });
  const [vaultBalance, processorBalance] = await Promise.all([
    publicClient.getBalance({ address: serverConfig.vaultAddress, blockNumber }),
    publicClient.readContract({ address: processor, abi: taxProcessorAbi, functionName: "marketQuoteBalance", blockNumber }) as Promise<bigint>,
  ]);
  return {
    rounds,
    settledRoundIds,
    prizesAllocated: prizesAllocated.toString(),
    roundPots: roundPots.toString(),
    taxCollected: (flushed + vaultBalance + processorBalance).toString(),
    blockNumber: blockNumber.toString(),
  };
}, { maxAge: 60, swr: false });
