# Flap vault port

## Problem

The prior token combined tax collection, historical balance snapshots, and holder registration. A Flap Tax Token V3 replaces tax collection but exposes only standard ERC-20 balances and Transfer logs. The port preserves VRF draws, ticket overrides, prize accounting, and one-transaction claims while moving historical eligibility to server-signed records.

## Usage

The deployer predicts the Flap token address from the selected salt, then deploys the lottery with that immutable token address and the server signer. VaultPortal calls the factory before it creates the token:

```solidity
FlapDoubleBallLottery lottery = new FlapDoubleBallLottery(
    predictedToken,
    vrfCoordinator,
    subscriptionId,
    keyHash,
    eligibilitySigner
);

params.vaultFactory = address(vaultFactory);
params.vaultData = abi.encode(address(lottery));
params.quoteToken = address(0);
params.mktBps = 10_000;
params.deflationBps = 0;
params.dividendBps = 0;
params.lpBps = 0;

address token = vaultPortal.newTokenV6WithVault{value: params.quoteAmt}(params);
```

The round worker dispatches pending Flap tax, flushes the vault, builds a finalized balance manifest, and prepares the next round. It stores every signature before it requests randomness:

```ts
await dispatchFlapTax()
await flushRevenueVault()

const manifest = await buildEligibilityManifest()
const roundId = await prepareRound(manifest.summary)
await storeSignedEligibility(roundId, manifest.records)
await requestDraw(roundId)
```

A claimant fetches one certificate for an account and round. The same certificate covers single and batch claims:

```ts
const eligibility = await $fetch("/api/eligibility-certificate", {
  query: { account, roundId },
})

await claimWinnings(roundId, ticketIndex, eligibility.claim, eligibility.signature)
```

## Shape

The Flap adapter stays separate from the lottery. `LotteryRevenueVault` inherits the canonical `VaultBaseV3`, recognizes native BNB by balance delta, and exposes permissionless `sync()` and `flush()`. Its `receive()` never performs an external call. `flush()` reduces `accountedQuote` before calling the immutable lottery revenue sink. A revert restores both balance and accounting.

`LotteryRevenueVaultFactory` inherits `VaultFactoryBaseV2`, reports factory spec `v2.3`, accepts only native BNB, and validates that all tax allocation goes to the vault. VaultPortal alone may create a BeaconProxy. Flap Guardian alone may upgrade or permanently lock the beacon. The Guardian has no authority in the lottery.

The lottery uses explicit round state:

```solidity
enum RoundPhase { None, Prepared, Drawing, Drawn, Settled, Cancelled }

struct EligibilityClaim {
    uint256 roundId;
    address account;
    uint256 eligibleBalance;
    bytes32 eligibilitySetId;
}

struct Round {
    uint256 id;
    RoundPhase phase;
    uint256 eligibilityBlock;
    bytes32 eligibilityBlockHash;
    address eligibilitySigner;
    bytes32 eligibilitySetId;
    bytes32 manifestHash;
    uint256 eligibleHolderCount;
    uint256 totalEligibleTickets;
    // VRF, winning numbers, and prize accounting fields follow.
}
```

`prepareRound()` freezes the block, block hash, current signer, manifest hash, pot, and ticket-configuration epoch. `requestDraw()` is the only transition from `Prepared` to `Drawing`. The server must store all signed claims before calling it. VRF retry, cancellation, and settlement cannot alter eligibility.

The EIP-712 domain binds chain ID and lottery address. `EligibilityClaim` binds account, round, balance, and `eligibilitySetId`. The contract derives ticket count as `eligibleBalance / TICKET_COST`, caches the first valid count for that account and round, and rejects later changes. Registered holder and ticket totals cannot exceed the frozen manifest totals. Per-ticket claimed state remains the replay guard.

Ticket overrides and exclusions use checkpoints keyed by `effectiveRoundId`. A change made after round N is prepared applies from N+1. Claims use the round checkpoint and never current mutable state.

The server owns four concrete records:

```ts
interface TokenIndexCursor {
  token: Address
  blockNumber: bigint
  blockHash: Hex
}

interface IndexedBalance {
  account: Address
  balance: bigint
}

interface EligibilityRun {
  lottery: Address
  roundId: bigint
  blockNumber: bigint
  blockHash: Hex
  manifestHash: Hex
  status: "building" | "prepared" | "signed" | "drawing"
}

interface EligibilityRecord {
  lottery: Address
  roundId: bigint
  account: Address
  eligibleBalance: bigint
  ticketCount: bigint
  eligibilitySetId: Hex
  signature: Hex
}
```

Transfer-log indexing and manifest construction are deterministic utilities with reorg checks. A SurrealDB cursor and atomically published balance index let later rounds replay only new logs; a cursor hash mismatch triggers a full rebuild from deployment. Settlement, ticket caching, and claim APIs read the frozen eligibility records. They never fall back to a current token balance for a prepared or completed round.

## Synthesis decision

The base is the separated-vault design. The two-step round lifecycle comes from the prepared-round candidate because it creates a clear database durability boundary before VRF. The beacon and V3 accounting follow Flap's current quick-start path. Signed eligible balance, rather than signed ticket count, keeps the ticket-cost rule onchain. Explicit eligibility fields replace the rejected compatibility trick of storing a block number in `snapshotId`.

## Tradeoffs accepted

- We accept one permissionless vault flush transaction in exchange for keeping Flap receive and upgrade rules out of the lottery.
- We accept Guardian control over the small forwarding beacon in exchange for the Flap verification path. The Guardian cannot change lottery code or withdraw its existing pot.
- We accept server authority over eligibility in exchange for removing balance snapshots. A manifest hash makes the signed set auditable but does not stop a compromised signer from issuing another certificate.
- We accept native-BNB-only launches in exchange for preserving prize, charity, and VRF funding behavior.
- We accept a new lottery address and database namespace so no historical balance state is reused.

## Alternatives considered

- Making the full lottery a vault lost because it couples Guardian access, proxy storage, and receive-gas rules to VRF and prize custody.
- Direct Portal funding lost because the selected product path requires VaultPortal discovery and vault UI metadata.
- An immutable forwarding vault lost because it cannot follow the low-risk beacon verification path without another token migration.
- Merkle membership is stronger than signatures alone, but the requested trust model uses server-signed balances. It remains a compatible future hardening step.

## Risks

- A compromised eligibility signer can create tickets after a draw. Keep it separate from the settlement key, sign the complete set before `requestDraw()`, and store signatures permanently.
- The holder index must detect BSC reorgs and reconcile Transfer totals before preparation.
- Revenue arriving after `flush()` belongs to the next round.
- The factory must stay pinned to the vendored Flap interface commit and fork tests must exercise the live VaultPortal.

The files under `packages/contracts/src/flap` are vendored from `flap-sh/FlapVaultExample` commit `ddae5e03330c4b16525a09b5f03f54f37302b038`. Treat that directory as read-only and review upstream changes before updating the pin.

## Implementation sequence

1. Vendor the pinned Flap interfaces and prove vault/factory behavior.
2. Add the explicit lottery round and EIP-712 eligibility model.
3. Add deterministic holder indexing, manifest persistence, and signing.
4. Update settlement, claims, ABIs, readiness, and deployment tooling.
5. Run unit, integration, production-hardening, BSC fork, build, and static checks.
