// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library FlapLotteryTypes {
    enum RoundPhase {
        None,
        Prepared,
        Drawing,
        Drawn,
        Settled,
        Cancelled
    }

    struct Ticket {
        uint8[6] redBalls;
        uint8 blueBall;
    }

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
        uint256 requestId;
        uint256 startBlock;
        uint256 startTime;
        uint256 endTime;
        uint256 drawBlock;
        uint8[6] redBalls;
        uint8 blueBall;
        uint256[6] tierWinnerCounts;
        uint256 totalPot;
        uint256 stashedPot;
        uint256 rolloverAmount;
        uint256 jackpotBonus;
        uint256 totalClaimed;
    }

    event RoundPrepared(
        uint256 indexed roundId,
        uint256 indexed eligibilityBlock,
        bytes32 eligibilityBlockHash,
        address indexed eligibilitySigner,
        bytes32 eligibilitySetId,
        bytes32 manifestHash,
        uint256 eligibleHolderCount,
        uint256 totalEligibleTickets,
        uint256 totalPot
    );

    event EligibilityRegistered(
        uint256 indexed roundId, address indexed account, uint256 eligibleBalance, uint256 ticketCount
    );

    event WinningsClaimed(
        address indexed user, uint256 indexed roundId, uint256 ticketIndex, uint256 amount, uint8 tier
    );

    event RoundDrawn(uint256 indexed roundId, uint8[6] redBalls, uint8 blueBall, uint256 totalPot, uint256 drawBlock);

    event RoundSettled(uint256 indexed roundId, uint256[6] tierWinnerCounts, uint256 totalPot);

    event RoundSettledWithRollover(
        uint256 indexed roundId,
        uint256[6] tierWinnerCounts,
        uint256 totalPot,
        uint256 stashedPot,
        uint256 rolloverAmount
    );

    event TicketNumbersChanged(address indexed user, uint256 indexed ticketIndex, uint8[6] redBalls, uint8 blueBall);
    event TicketOverrideCleared(address indexed user, uint256 indexed ticketIndex);
    event LotteryPaused(bool paused);
    event VRFSubscriptionFunded(uint64 indexed subId, uint256 amount);
}
