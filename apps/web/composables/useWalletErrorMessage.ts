type WalletError = {
  code?: number;
  message?: string;
};

export const isUserRejectedError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const err = error as WalletError;
  const message = String(err.message ?? "");
  return (
    err.code === 4001 ||
    /user rejected|rejected the request|request rejected|user denied|denied request/i.test(message)
  );
};

export const getWalletErrorMessage = (
  error: unknown,
  options?: {
    rejectedMessage?: string;
    fallbackMessage?: string;
  },
) => {
  if (isUserRejectedError(error)) {
    return options?.rejectedMessage ?? "User rejected the request";
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as WalletError).message ?? "");
    if (message) return message;
  }

  return options?.fallbackMessage ?? "Request failed";
};
