import { formatEther } from "viem";

type BnbDisplayValue = bigint | string | number;
type BallDisplayValue = bigint | string | number | null | undefined;

export function formatBnbDisplay(value: BnbDisplayValue, fractionDigits?: number): string {
  const amount = typeof value === "bigint" ? Number(formatEther(value)) : Number(value);
  if (!Number.isFinite(amount)) {
    return (0).toFixed(fractionDigits ?? 2);
  }
  const resolvedFractionDigits = fractionDigits ?? (
    amount === 0 || Math.abs(amount) >= 1
      ? 2
      : Math.abs(amount) >= 0.01
        ? 4
        : 6
  );
  return amount.toFixed(resolvedFractionDigits);
}

export function formatBallDisplay(value: BallDisplayValue): string {
  const numeric = typeof value === "bigint" ? Number(value) : Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "00";
  }
  return Math.trunc(numeric).toString().padStart(2, "0");
}
