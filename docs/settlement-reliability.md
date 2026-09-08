# Settlement reliability

## Problem

Settlement turns an off-chain eligibility snapshot into irreversible on-chain winner counts. The database may change after the contract freezes its manifest, and the worker may lose its distributed lease while it is preparing or submitting a round. Receipt finality, scheduler responses, and projection fallback behavior must make those failure modes explicit.

## Usage

Settlement loads one verified snapshot and processes only the returned certificates:

```ts
const certificates = await loadVerifiedEligibilitySnapshot(round, context);
const tierCounts = await countWinners(certificates);
await submitSettlement(round.id, tierCounts);
```

Round-start code receives the same task context used by the settlement worker:

```ts
await startNewLotteryRound(context);
```

Cron routes translate task results into an HTTP status and body through one helper:

```ts
return respondToCronTask(event, "settle", await runSettleTask());
```

## Shape

- `eligibility.ts` owns pure manifest and certificate validation.
- `eligibility-service.ts` loads a complete snapshot, checks it against the frozen round, and returns the exact rows settlement consumes.
- `TaskRunContext` crosses round-start boundaries. Database writes use its fence, and irreversible steps use checkpoints.
- `contract.ts` applies one configurable receipt-confirmation policy to backend writes.
- `cronResponse.ts` maps task outcomes to HTTP responses.
- Winner APIs use RPC reconstruction only for an incomplete projection while the eligibility database remains available. Dependency failures return 503.

## Synthesis decision

The fix keeps the current worker and database model. It adds validation at the irreversible boundary instead of introducing a second manifest store or another settlement state machine.

## Tradeoffs accepted

- Settlement keeps all eligibility certificates in memory so validation and winner counting use the same snapshot. The worker already retains batch metadata for every holder, so this does not introduce a new scaling class.
- Every certificate signature is checked once per settlement. This adds work but prevents corrupted signatures from reserving prizes that nobody can claim.
- A stale projection is removed only when its transaction receipt is missing or non-canonical. Other chain and database inconsistencies fail closed.

## Alternatives considered

- A second immutable copy of eligibility data was rejected because it creates another synchronized state store.
- Re-reading paginated rows after validation was rejected because it leaves a validation-to-use race.
- Treating every winner projection error as an RPC fallback was rejected because historical ticket counts still come from the eligibility database.

## Open questions and risks

- Operators must choose a confirmation count appropriate for the configured chain. The default is three.
- A chain reorganization deeper than the confirmation policy still requires reconciliation, so the worker verifies the stored settlement receipt before discarding a stale projection.

## Next implementation step

Add boundary tests for frozen eligibility validation, lease-aware round starts, receipt confirmation policy, and cron result mapping.
