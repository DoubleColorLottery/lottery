import { ref } from "vue";

export interface WinRecord {
  ticketIndex: number;
  tier: number;
  prizeAmount: string;
  prizeAmountEth: string;
  claimed: boolean;
  redBalls: number[];
  blueBall: number;
}

export interface RoundSummary {
  roundId: number;
  ticketCount: number;
  unclaimedCount: number;
  totalPrize: string;
  totalPrizeEth: string;
  unclaimedPrize: string;
  unclaimedPrizeEth: string;
  settled: boolean;
}

export interface UserWinsSummaryResponse {
  success: boolean;
  address: string;
  totalWins: number;
  totalPrize: string;
  totalPrizeEth: string;
  page: number;
  limit: number;
  totalRounds: number;
  totalPages: number;
  hasMore: boolean;
  rounds: RoundSummary[];
}

export interface UserWinsTicketsResponse {
  success: boolean;
  roundId: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  tickets: WinRecord[];
}

export const useClaimsApi = () => {
  const loading = ref(false);
  const error = ref<string | null>(null);

  const getUserWinsSummary = async (
    address: string,
    page: number = 0,
    limit: number = 20,
    updateLoading: boolean = true,
  ): Promise<UserWinsSummaryResponse | null> => {
    try {
      if (updateLoading) loading.value = true;
      error.value = null;

      return await $fetch<UserWinsSummaryResponse>(`/api/user-wins`, {
        query: { address: address.toLowerCase(), page, limit },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch user wins";
      error.value = message;
      console.error("Error fetching user wins:", err);
      return null;
    } finally {
      if (updateLoading) loading.value = false;
    }
  };

  const getUserWinsTickets = async (
    address: string,
    roundId: number,
    page: number = 0,
    limit: number = 50,
  ): Promise<UserWinsTicketsResponse | null> => {
    try {
      return await $fetch<UserWinsTicketsResponse>(`/api/user-wins-tickets`, {
        query: {
          address: address.toLowerCase(),
          roundId,
          page,
          limit,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch tickets";
      error.value = message;
      console.error("Error fetching tickets:", err);
      return null;
    }
  };

  const checkTicketWin = async (ticketRed: number[], ticketBlue: number, winningRed: number[], winningBlue: number) => {
    try {
      return await $fetch(`/api/check-win`, {
        method: "POST",
        body: { ticketRed, ticketBlue, winningRed, winningBlue },
      });
    } catch (err: unknown) {
      console.error("Error checking win:", err);
      return { tier: 0, isWinner: false };
    }
  };

  const getRoundStatus = async () => {
    try {
      loading.value = true;
      error.value = null;

      return await $fetch(`/api/round-status`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch round status";
      error.value = message;
      console.error("Error fetching round status:", err);
      return null;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    getUserWinsSummary,
    getUserWinsTickets,
    checkTicketWin,
    getRoundStatus,
  };
};
