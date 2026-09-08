export class IncompleteWinnerProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteWinnerProjectionError";
  }
}

export function shouldUseWinnerProjectionFallback(error: unknown): error is IncompleteWinnerProjectionError {
  return error instanceof IncompleteWinnerProjectionError;
}
