// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {FlapLotteryTypes} from "./FlapLotteryTypes.sol";
import {VRFConsumerBase} from "../vrf/VRFConsumerBase.sol";
import {VRFCoordinatorInterface} from "../vrf/VRFCoordinatorInterface.sol";

/// @title Flap DoubleBall Lottery
/// @notice BNB-funded lottery with Flap ERC-20 tickets and server-signed historical eligibility.
contract FlapDoubleBallLottery is VRFConsumerBase, ReentrancyGuard, Ownable2Step, EIP712 {
    uint256 private constant VRF_FUNDING_AMOUNT = 0.005 ether;
    uint256 public constant TICKET_COST = 2_000 ether;
    uint256 public constant MAX_OVERRIDE_BATCH = 5_000;
    uint256 public constant MAX_CLAIM_BATCH = 100;
    uint32 public constant NUM_WORDS = 7;

    uint256 public constant TIER1_PERCENTAGE = 35;
    uint256 public constant TIER2_PERCENTAGE = 25;
    uint256 public constant TIER3_PERCENTAGE = 20;
    uint256 public constant TIER4_PERCENTAGE = 10;
    uint256 public constant TIER5_PERCENTAGE = 7;
    uint256 public constant TIER6_PERCENTAGE = 3;

    address public constant CHARITY_ADDRESS = 0x8B99F3660622e21f2910ECCA7fBe51d654a1517D;
    uint256 public constant CHARITY_PERCENTAGE = 5;

    bytes32 public constant ELIGIBILITY_TYPEHASH =
        keccak256("EligibilityClaim(uint256 roundId,address account,uint256 eligibleBalance,bytes32 eligibilitySetId)");

    IERC20 public immutable taxToken;
    VRFCoordinatorInterface public immutable vrfCoordinator;
    bytes32 public immutable keyHash;

    address public eligibilitySigner;
    uint64 public subscriptionId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 500_000;
    uint16 public eligibilityConfirmations = 15;

    uint256 public totalWBNBInPot;
    uint256 public accumulatedJackpotBonus;
    uint256 public lotteryInterval = 6_000;
    uint256 public lastLotteryBlock;
    uint256 public currentRoundId;
    uint256 public currentRequestId;
    uint256 public drawTimeoutBlocks = 7_200;
    bool public lotteryEnabled;

    mapping(uint256 => FlapLotteryTypes.Round) public rounds;
    mapping(uint256 => uint256) public requestToRound;
    mapping(uint256 => uint256) public lastVRFRequestBlock;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public ticketClaimed;

    mapping(uint256 => mapping(address => bool)) public eligibilityRegistered;
    mapping(uint256 => mapping(address => uint256)) public registeredEligibleBalance;
    mapping(uint256 => mapping(address => uint256)) public registeredTicketCount;
    mapping(uint256 => uint256) public registeredHolderCount;
    mapping(uint256 => uint256) public registeredTicketsTotal;

    mapping(address => mapping(uint256 => FlapLotteryTypes.Ticket)) public ticketOverrides;
    mapping(address => mapping(uint256 => bool)) public hasTicketOverride;
    mapping(address => bool) public isExcludedFromTickets;

    struct OverrideCheckpoint {
        uint256 fromRound;
        uint8[6] redBalls;
        uint8 blueBall;
        bool exists;
    }

    struct ExclusionCheckpoint {
        uint256 fromRound;
        bool excluded;
    }

    mapping(address => mapping(uint256 => OverrideCheckpoint[])) private _overrideHistory;
    mapping(address => ExclusionCheckpoint[]) private _exclusionHistory;

    event PotIncreased(uint256 amount, uint256 newTotal);
    event ManualPotFunding(address indexed funder, uint256 amount, uint256 newTotal);
    event CharityDonation(uint256 indexed roundId, address indexed charity, uint256 amount);
    event LotteryStarted(uint256 indexed roundId, uint256 requestId);
    event LotteryNumbersDrawn(uint256 indexed roundId, uint8[6] redBalls, uint8 blueBall);
    event EligibilitySignerUpdated(address indexed previousSigner, address indexed newSigner);
    event EligibilityConfirmationsUpdated(uint16 confirmations);
    event VRFConfigUpdated(uint64 subId, uint32 gasLimit, uint16 confirmations);
    event LotteryIntervalUpdated(uint256 newInterval);
    event DrawTimeoutUpdated(uint256 newTimeout);
    event ExclusionUpdated(address indexed account, bool excluded, uint256 indexed fromRound);
    event VRFRetryRequested(uint256 indexed roundId, uint256 newRequestId);
    event EmergencyStop(uint256 indexed roundId);
    event RoundCancelled(uint256 indexed roundId, uint256 requestId);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidEligibility();
    error InvalidEligibilityBlock();
    error InvalidEligibilitySummary();
    error InvalidWinnerCounts();
    error EligibilityAlreadyRegistered();
    error EligibilityCapacityExceeded();
    error LotteryNotEnabled();
    error LotteryAlreadyInProgress();
    error CannotStartYet();
    error InvalidVRFRequest();
    error InvalidRound();
    error InvalidRoundPhase();
    error RoundNotSettled();
    error AlreadyClaimed();
    error NotAWinner();
    error NoWinnersInTier();
    error InvalidTicketIndex();
    error InvalidBallNumbers();
    error DrawNotTimedOut();
    error NoDrawInProgress();
    error PrizeTransferFailed();
    error CharityTransferFailed();
    error InsufficientPot();
    error IntervalTooShort();
    error TimeoutTooSmall();
    error PreviousRoundNotSettled();
    error UnsupportedTokenDecimals();
    error BatchTooLarge();

    constructor(
        address taxToken_,
        address vrfCoordinator_,
        uint64 subscriptionId_,
        bytes32 keyHash_,
        address eligibilitySigner_
    ) VRFConsumerBase(vrfCoordinator_) Ownable(msg.sender) EIP712("FlapDoubleBallLottery", "1") {
        if (taxToken_ == address(0) || vrfCoordinator_ == address(0) || eligibilitySigner_ == address(0)) {
            revert InvalidAddress();
        }
        if (keyHash_ == bytes32(0)) revert InvalidVRFRequest();

        taxToken = IERC20(taxToken_);
        vrfCoordinator = VRFCoordinatorInterface(vrfCoordinator_);
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        eligibilitySigner = eligibilitySigner_;
    }

    receive() external payable {
        totalWBNBInPot += msg.value;
        emit PotIncreased(msg.value, totalWBNBInPot);
    }

    function fundPot() external payable {
        if (msg.value == 0) revert InvalidAmount();
        totalWBNBInPot += msg.value;
        emit ManualPotFunding(msg.sender, msg.value, totalWBNBInPot);
    }

    function lotteryInProgress() public view returns (bool) {
        FlapLotteryTypes.RoundPhase phase = rounds[currentRoundId].phase;
        return phase == FlapLotteryTypes.RoundPhase.Prepared || phase == FlapLotteryTypes.RoundPhase.Drawing;
    }

    function canStartLottery() public view returns (bool) {
        bool previousComplete = currentRoundId == 0 || _isTerminal(rounds[currentRoundId].phase);
        return lotteryEnabled && !lotteryInProgress() && block.number >= lastLotteryBlock + lotteryInterval
            && previousComplete;
    }

    function getTicketCount(address user) public view returns (uint256) {
        if (isExcludedFromTickets[user] || address(taxToken).code.length == 0) return 0;
        return taxToken.balanceOf(user) / TICKET_COST;
    }

    function getRound(uint256 roundId) external view returns (FlapLotteryTypes.Round memory) {
        return rounds[roundId];
    }

    function eligibilityDigest(FlapLotteryTypes.EligibilityClaim calldata claim) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ELIGIBILITY_TYPEHASH, claim.roundId, claim.account, claim.eligibleBalance, claim.eligibilitySetId
                )
            )
        );
    }

    function verifyEligibility(FlapLotteryTypes.EligibilityClaim calldata claim, bytes calldata signature)
        public
        view
        returns (bool)
    {
        FlapLotteryTypes.Round storage round = rounds[claim.roundId];
        if (round.phase == FlapLotteryTypes.RoundPhase.None || round.phase == FlapLotteryTypes.RoundPhase.Cancelled) {
            return false;
        }
        if (claim.account == address(0) || claim.eligibilitySetId != round.eligibilitySetId) return false;
        uint256 ticketCount = claim.eligibleBalance / TICKET_COST;
        if (ticketCount == 0 || ticketCount > round.totalEligibleTickets) return false;

        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(eligibilityDigest(claim), signature);
        return error == ECDSA.RecoverError.NoError && recovered == round.eligibilitySigner;
    }

    function registerEligibility(FlapLotteryTypes.EligibilityClaim calldata claim, bytes calldata signature)
        public
        returns (uint256 ticketCount)
    {
        if (eligibilityRegistered[claim.roundId][claim.account]) {
            if (
                registeredEligibleBalance[claim.roundId][claim.account] != claim.eligibleBalance
                    || rounds[claim.roundId].eligibilitySetId != claim.eligibilitySetId
            ) {
                revert EligibilityAlreadyRegistered();
            }
            return registeredTicketCount[claim.roundId][claim.account];
        }

        if (!verifyEligibility(claim, signature)) revert InvalidEligibility();
        ticketCount = claim.eligibleBalance / TICKET_COST;
        FlapLotteryTypes.Round storage round = rounds[claim.roundId];
        if (
            registeredHolderCount[claim.roundId] + 1 > round.eligibleHolderCount
                || registeredTicketsTotal[claim.roundId] + ticketCount > round.totalEligibleTickets
        ) revert EligibilityCapacityExceeded();

        eligibilityRegistered[claim.roundId][claim.account] = true;
        registeredEligibleBalance[claim.roundId][claim.account] = claim.eligibleBalance;
        registeredTicketCount[claim.roundId][claim.account] = ticketCount;
        registeredHolderCount[claim.roundId]++;
        registeredTicketsTotal[claim.roundId] += ticketCount;

        emit FlapLotteryTypes.EligibilityRegistered(claim.roundId, claim.account, claim.eligibleBalance, ticketCount);
    }

    function getTicketCountWithEligibility(FlapLotteryTypes.EligibilityClaim calldata claim, bytes calldata signature)
        external
        view
        returns (uint256)
    {
        if (eligibilityRegistered[claim.roundId][claim.account]) {
            if (registeredEligibleBalance[claim.roundId][claim.account] != claim.eligibleBalance) {
                revert EligibilityAlreadyRegistered();
            }
            return registeredTicketCount[claim.roundId][claim.account];
        }
        if (!verifyEligibility(claim, signature)) revert InvalidEligibility();
        return claim.eligibleBalance / TICKET_COST;
    }

    function prepareRound(
        uint256 eligibilityBlock,
        bytes32 eligibilityBlockHash,
        bytes32 manifestHash,
        uint256 eligibleHolderCount,
        uint256 totalEligibleTickets
    ) external onlyOwner returns (uint256 roundId) {
        if (!canStartLottery()) {
            if (!lotteryEnabled) revert LotteryNotEnabled();
            if (lotteryInProgress()) revert LotteryAlreadyInProgress();
            if (block.number < lastLotteryBlock + lotteryInterval) revert CannotStartYet();
            revert PreviousRoundNotSettled();
        }
        if (address(taxToken).code.length == 0) revert InvalidAddress();
        if (IERC20Metadata(address(taxToken)).decimals() != 18) revert UnsupportedTokenDecimals();
        if (eligibilitySigner == address(0)) revert InvalidAddress();
        if (
            eligibleHolderCount == 0 || totalEligibleTickets == 0 || eligibleHolderCount > totalEligibleTickets
                || totalEligibleTickets > taxToken.totalSupply() / TICKET_COST || manifestHash == bytes32(0)
        ) {
            revert InvalidEligibilitySummary();
        }
        if (
            eligibilityBlock >= block.number || block.number - eligibilityBlock < eligibilityConfirmations
                || block.number - eligibilityBlock > 256 || eligibilityBlockHash == bytes32(0)
                || blockhash(eligibilityBlock) != eligibilityBlockHash
        ) {
            revert InvalidEligibilityBlock();
        }

        roundId = ++currentRoundId;
        FlapLotteryTypes.Round storage round = rounds[roundId];
        round.id = roundId;
        round.phase = FlapLotteryTypes.RoundPhase.Prepared;
        round.eligibilityBlock = eligibilityBlock;
        round.eligibilityBlockHash = eligibilityBlockHash;
        round.eligibilitySigner = eligibilitySigner;
        round.manifestHash = manifestHash;
        round.eligibleHolderCount = eligibleHolderCount;
        round.totalEligibleTickets = totalEligibleTickets;
        round.startBlock = block.number;
        round.startTime = block.timestamp;
        round.totalPot = totalWBNBInPot;
        round.eligibilitySetId = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(taxToken),
                roundId,
                eligibilityBlock,
                eligibilityBlockHash,
                eligibilitySigner,
                TICKET_COST,
                manifestHash,
                eligibleHolderCount,
                totalEligibleTickets
            )
        );

        emit FlapLotteryTypes.RoundPrepared(
            roundId,
            eligibilityBlock,
            eligibilityBlockHash,
            eligibilitySigner,
            round.eligibilitySetId,
            manifestHash,
            eligibleHolderCount,
            totalEligibleTickets,
            round.totalPot
        );
    }

    function requestDraw(uint256 roundId) external payable onlyOwner nonReentrant returns (uint256 requestId) {
        if (roundId != currentRoundId) revert InvalidRound();
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Prepared) revert InvalidRoundPhase();

        _handleOptionalVRFFunding();
        round.phase = FlapLotteryTypes.RoundPhase.Drawing;

        requestId = vrfCoordinator.requestRandomWords(
            keyHash, subscriptionId, requestConfirmations, callbackGasLimit, NUM_WORDS
        );
        if (requestId == 0) revert InvalidVRFRequest();

        currentRequestId = requestId;
        round.requestId = requestId;
        lastVRFRequestBlock[roundId] = block.number;
        requestToRound[requestId] = roundId;
        emit LotteryStarted(roundId, requestId);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        if (randomWords.length != NUM_WORDS) revert InvalidVRFRequest();

        uint256 roundId = requestToRound[requestId];
        if (roundId == 0) revert InvalidVRFRequest();
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Drawing || round.requestId != requestId) {
            revert InvalidVRFRequest();
        }

        uint8[6] memory winningRed;
        bool[34] memory usedNumbers;
        for (uint256 i = 0; i < 6; i++) {
            uint8 number;
            uint256 attempts;
            do {
                number = uint8((randomWords[i] + attempts) % 33) + 1;
                attempts++;
            } while (usedNumbers[number] && attempts < 100);
            winningRed[i] = number;
            usedNumbers[number] = true;
        }

        round.redBalls = _sortArray(winningRed);
        round.blueBall = uint8((randomWords[6] % 16) + 1);
        round.drawBlock = block.number;
        round.endTime = block.timestamp;
        round.phase = FlapLotteryTypes.RoundPhase.Drawn;
        round.requestId = 0;

        emit LotteryNumbersDrawn(roundId, round.redBalls, round.blueBall);
        emit FlapLotteryTypes.RoundDrawn(roundId, round.redBalls, round.blueBall, round.totalPot, block.number);

        if (requestId == currentRequestId) {
            lastLotteryBlock = block.number;
            currentRequestId = 0;
        }
        delete requestToRound[requestId];
        delete lastVRFRequestBlock[roundId];
    }

    function settleRound(uint256 roundId, uint256[6] calldata tierWinnerCounts) external onlyOwner nonReentrant {
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Drawn) revert InvalidRoundPhase();
        uint256 totalWinners;
        for (uint256 i = 0; i < tierWinnerCounts.length; i++) {
            totalWinners += tierWinnerCounts[i];
        }
        if (totalWinners > round.totalEligibleTickets) revert InvalidWinnerCounts();
        round.tierWinnerCounts = tierWinnerCounts;

        uint256 charityAmount = (round.totalPot * CHARITY_PERCENTAGE) / 100;
        if (charityAmount > 0) {
            if (charityAmount > totalWBNBInPot) revert InsufficientPot();
            totalWBNBInPot -= charityAmount;
            round.totalPot -= charityAmount;
        }

        uint256 tier1Share = (round.totalPot * TIER1_PERCENTAGE) / 100;
        uint256 jackpotBonusForRound;
        uint256 stashedPercentage;
        uint256 jackpotBonusThisRound;

        if (tierWinnerCounts[0] > 0) {
            stashedPercentage += TIER1_PERCENTAGE;
            jackpotBonusForRound = accumulatedJackpotBonus;
            accumulatedJackpotBonus = 0;
        } else {
            jackpotBonusThisRound = (tier1Share * 20) / 100;
            accumulatedJackpotBonus += jackpotBonusThisRound;
        }

        if (tierWinnerCounts[1] > 0) stashedPercentage += TIER2_PERCENTAGE;
        if (tierWinnerCounts[2] > 0) stashedPercentage += TIER3_PERCENTAGE;
        if (tierWinnerCounts[3] > 0) stashedPercentage += TIER4_PERCENTAGE;
        if (tierWinnerCounts[4] > 0) stashedPercentage += TIER5_PERCENTAGE;
        if (tierWinnerCounts[5] > 0) stashedPercentage += TIER6_PERCENTAGE;

        uint256 potBasedStash = (round.totalPot * stashedPercentage) / 100;
        uint256 potToStash = potBasedStash + jackpotBonusForRound;
        uint256 rollover = round.totalPot - potBasedStash;
        if (tierWinnerCounts[0] == 0) rollover -= jackpotBonusThisRound;

        uint256 totalToDeduct = potBasedStash + jackpotBonusThisRound;
        if (totalToDeduct > totalWBNBInPot) {
            totalToDeduct = totalWBNBInPot;
            potBasedStash = totalToDeduct > jackpotBonusThisRound ? totalToDeduct - jackpotBonusThisRound : 0;
            potToStash = potBasedStash + jackpotBonusForRound;
        }
        totalWBNBInPot -= totalToDeduct;

        round.stashedPot = potToStash;
        round.rolloverAmount = rollover;
        round.jackpotBonus = jackpotBonusForRound;
        round.phase = FlapLotteryTypes.RoundPhase.Settled;

        if (charityAmount > 0) {
            (bool success,) = payable(CHARITY_ADDRESS).call{value: charityAmount}("");
            if (!success) revert CharityTransferFailed();
            emit CharityDonation(roundId, CHARITY_ADDRESS, charityAmount);
        }

        emit FlapLotteryTypes.RoundSettled(roundId, tierWinnerCounts, round.totalPot);
        emit FlapLotteryTypes.RoundSettledWithRollover(roundId, tierWinnerCounts, round.totalPot, potToStash, rollover);
    }

    function claimWinnings(
        uint256 roundId,
        uint256 ticketIndex,
        FlapLotteryTypes.EligibilityClaim calldata claim,
        bytes calldata signature
    ) external nonReentrant {
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Settled) revert RoundNotSettled();
        if (claim.roundId != roundId || claim.account != msg.sender) revert InvalidEligibility();
        if (ticketClaimed[roundId][msg.sender][ticketIndex]) revert AlreadyClaimed();

        uint256 ticketCount = registerEligibility(claim, signature);
        if (ticketIndex >= ticketCount) revert InvalidTicketIndex();

        (uint8[6] memory reds, uint8 blue) = getTicket(msg.sender, roundId, ticketIndex);
        uint8 tier = _matchTier(reds, blue, round.redBalls, round.blueBall);
        if (tier == 0) revert NotAWinner();

        uint256 winnerCount = round.tierWinnerCounts[tier - 1];
        if (winnerCount == 0) revert NoWinnersInTier();
        uint256 prize = _prizeFor(round, tier, winnerCount);
        uint256 available = round.stashedPot - round.totalClaimed;
        if (prize > available) prize = available;

        ticketClaimed[roundId][msg.sender][ticketIndex] = true;
        round.totalClaimed += prize;
        (bool success,) = payable(msg.sender).call{value: prize}("");
        if (!success) revert PrizeTransferFailed();

        emit FlapLotteryTypes.WinningsClaimed(msg.sender, roundId, ticketIndex, prize, tier);
    }

    function claimWinningsBatch(
        uint256 roundId,
        uint256[] calldata ticketIndices,
        FlapLotteryTypes.EligibilityClaim calldata claim,
        bytes calldata signature
    ) external nonReentrant {
        if (ticketIndices.length == 0 || ticketIndices.length > MAX_CLAIM_BATCH) {
            revert BatchTooLarge();
        }
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Settled) revert RoundNotSettled();
        if (claim.roundId != roundId || claim.account != msg.sender) revert InvalidEligibility();

        uint256 ticketCount = registerEligibility(claim, signature);
        uint256 totalPayout;
        uint256 available = round.stashedPot - round.totalClaimed;

        for (uint256 i = 0; i < ticketIndices.length; i++) {
            uint256 ticketIndex = ticketIndices[i];
            if (ticketIndex >= ticketCount || ticketClaimed[roundId][msg.sender][ticketIndex]) continue;

            (uint8[6] memory reds, uint8 blue) = getTicket(msg.sender, roundId, ticketIndex);
            uint8 tier = _matchTier(reds, blue, round.redBalls, round.blueBall);
            if (tier == 0) continue;

            uint256 winnerCount = round.tierWinnerCounts[tier - 1];
            if (winnerCount == 0) continue;
            uint256 prize = _prizeFor(round, tier, winnerCount);
            if (totalPayout + prize > available) {
                prize = available - totalPayout;
                if (prize == 0) break;
            }

            ticketClaimed[roundId][msg.sender][ticketIndex] = true;
            totalPayout += prize;
            emit FlapLotteryTypes.WinningsClaimed(msg.sender, roundId, ticketIndex, prize, tier);
        }

        if (totalPayout > 0) {
            round.totalClaimed += totalPayout;
            (bool success,) = payable(msg.sender).call{value: totalPayout}("");
            if (!success) revert PrizeTransferFailed();
        }
    }

    function deriveTicket(address user, uint256 roundId, uint256 ticketIndex)
        public
        view
        returns (uint8[6] memory redBalls, uint8 blueBall)
    {
        uint256 seed = uint256(keccak256(abi.encode(block.chainid, address(this), user, roundId, ticketIndex)));
        redBalls = _generateRandomRedBalls(seed);
        blueBall = uint8((seed % 16) + 1);
    }

    function getTicket(address user, uint256 roundId, uint256 ticketIndex)
        public
        view
        returns (uint8[6] memory redBalls, uint8 blueBall)
    {
        uint256 targetRound = roundId == 0 ? currentRoundId + 1 : roundId;
        (bool exists, uint8[6] memory overrideReds, uint8 overrideBlue) = _getOverrideAt(user, ticketIndex, targetRound);
        if (exists) return (overrideReds, overrideBlue);
        return deriveTicket(user, targetRound, ticketIndex);
    }

    function getTicketOverridesBatch(address user, uint256 roundId, uint256 startIndex, uint256 count)
        external
        view
        returns (uint256[] memory indices, uint8[6][] memory redBalls, uint8[] memory blueBalls)
    {
        if (count > MAX_OVERRIDE_BATCH || startIndex > type(uint256).max - count) revert BatchTooLarge();
        uint256 targetRound = roundId == 0 ? currentRoundId + 1 : roundId;
        uint256 overrideCount;
        for (uint256 i = startIndex; i < startIndex + count; i++) {
            (bool exists,,) = _getOverrideAt(user, i, targetRound);
            if (exists) overrideCount++;
        }

        indices = new uint256[](overrideCount);
        redBalls = new uint8[6][](overrideCount);
        blueBalls = new uint8[](overrideCount);
        uint256 outputIndex;
        for (uint256 i = startIndex; i < startIndex + count; i++) {
            (bool exists, uint8[6] memory reds, uint8 blue) = _getOverrideAt(user, i, targetRound);
            if (!exists) continue;
            indices[outputIndex] = i;
            redBalls[outputIndex] = reds;
            blueBalls[outputIndex] = blue;
            outputIndex++;
        }
    }

    function changeTicketNumbers(uint256 ticketIndex, uint8[6] calldata redBalls, uint8 blueBall) external {
        if (ticketIndex >= getTicketCount(msg.sender)) revert InvalidTicketIndex();
        _validateBallNumbers(redBalls, blueBall);

        uint256 fromRound = currentRoundId + 1;
        _writeOverrideCheckpoint(msg.sender, ticketIndex, fromRound, redBalls, blueBall, true);
        ticketOverrides[msg.sender][ticketIndex] = FlapLotteryTypes.Ticket(redBalls, blueBall);
        hasTicketOverride[msg.sender][ticketIndex] = true;
        emit FlapLotteryTypes.TicketNumbersChanged(msg.sender, ticketIndex, redBalls, blueBall);
    }

    function clearTicketOverride(uint256 ticketIndex) external {
        if (!hasTicketOverride[msg.sender][ticketIndex]) revert InvalidTicketIndex();

        uint8[6] memory empty;
        uint256 fromRound = currentRoundId + 1;
        _writeOverrideCheckpoint(msg.sender, ticketIndex, fromRound, empty, 0, false);
        delete ticketOverrides[msg.sender][ticketIndex];
        delete hasTicketOverride[msg.sender][ticketIndex];
        emit FlapLotteryTypes.TicketOverrideCleared(msg.sender, ticketIndex);
    }

    function isExcludedAt(address account, uint256 roundId) public view returns (bool) {
        uint256 targetRound = roundId == 0 ? currentRoundId + 1 : roundId;
        ExclusionCheckpoint[] storage history = _exclusionHistory[account];
        uint256 low;
        uint256 high = history.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (history[mid].fromRound <= targetRound) low = mid + 1;
            else high = mid;
        }
        return low == 0 ? false : history[low - 1].excluded;
    }

    function checkTicket(address user, uint256 roundId, uint256 ticketIndex)
        external
        view
        returns (uint8 tier, uint256 prize, bool claimed)
    {
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Settled) return (0, 0, false);
        claimed = ticketClaimed[roundId][user][ticketIndex];
        if (!eligibilityRegistered[roundId][user] || ticketIndex >= registeredTicketCount[roundId][user]) {
            return (0, 0, claimed);
        }

        (uint8[6] memory reds, uint8 blue) = getTicket(user, roundId, ticketIndex);
        tier = _matchTier(reds, blue, round.redBalls, round.blueBall);
        uint256 winnerCount = tier == 0 ? 0 : round.tierWinnerCounts[tier - 1];
        if (winnerCount > 0) prize = _prizeFor(round, tier, winnerCount);
    }

    function retryVRFRequest() external payable onlyOwner nonReentrant {
        FlapLotteryTypes.Round storage round = rounds[currentRoundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Drawing) revert NoDrawInProgress();

        uint256 lastRequestBlock = lastVRFRequestBlock[currentRoundId];
        if (block.number <= lastRequestBlock + drawTimeoutBlocks) revert DrawNotTimedOut();
        if (round.requestId != 0) delete requestToRound[round.requestId];

        _handleOptionalVRFFunding();
        uint256 requestId = vrfCoordinator.requestRandomWords(
            keyHash, subscriptionId, requestConfirmations, callbackGasLimit, NUM_WORDS
        );
        if (requestId == 0) revert InvalidVRFRequest();

        currentRequestId = requestId;
        round.requestId = requestId;
        lastVRFRequestBlock[currentRoundId] = block.number;
        requestToRound[requestId] = currentRoundId;
        emit VRFRetryRequested(currentRoundId, requestId);
    }

    function setLotteryEnabled(bool enabled) external onlyOwner {
        lotteryEnabled = enabled;
        emit FlapLotteryTypes.LotteryPaused(!enabled);
    }

    function setLotteryInterval(uint256 blocks_) external onlyOwner {
        if (blocks_ < 200) revert IntervalTooShort();
        lotteryInterval = blocks_;
        emit LotteryIntervalUpdated(blocks_);
    }

    function setDrawTimeout(uint256 blocks_) external onlyOwner {
        if (blocks_ < 600) revert TimeoutTooSmall();
        drawTimeoutBlocks = blocks_;
        emit DrawTimeoutUpdated(blocks_);
    }

    function setEligibilitySigner(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidAddress();
        address previous = eligibilitySigner;
        eligibilitySigner = signer;
        emit EligibilitySignerUpdated(previous, signer);
    }

    function setEligibilityConfirmations(uint16 confirmations) external onlyOwner {
        if (confirmations == 0 || confirmations > 255) revert InvalidAmount();
        eligibilityConfirmations = confirmations;
        emit EligibilityConfirmationsUpdated(confirmations);
    }

    function setExcludedFromTickets(address account, bool excluded) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        uint256 fromRound = currentRoundId + 1;
        ExclusionCheckpoint[] storage history = _exclusionHistory[account];
        if (history.length > 0 && history[history.length - 1].fromRound == fromRound) {
            history[history.length - 1].excluded = excluded;
        } else {
            history.push(ExclusionCheckpoint({fromRound: fromRound, excluded: excluded}));
        }
        isExcludedFromTickets[account] = excluded;
        emit ExclusionUpdated(account, excluded, fromRound);
    }

    function setVRFConfig(uint64 subId, uint32 gasLimit, uint16 confirmations) external onlyOwner {
        subscriptionId = subId;
        callbackGasLimit = gasLimit;
        requestConfirmations = confirmations;
        emit VRFConfigUpdated(subId, gasLimit, confirmations);
    }

    function createVRFSubscription() external onlyOwner returns (uint64 newSubId) {
        newSubId = vrfCoordinator.createSubscription();
        subscriptionId = newSubId;
        vrfCoordinator.addConsumer(newSubId, address(this));
    }

    function getVRFSubscriptionInfo()
        external
        view
        returns (uint256 balance, uint64 reqCount, address subOwner, address[] memory consumers)
    {
        try vrfCoordinator.getSubscription(subscriptionId) returns (
            uint96 balance_, uint64 reqCount_, address owner_, address[] memory consumers_
        ) {
            return (uint256(balance_), reqCount_, owner_, consumers_);
        } catch {
            return (0, 0, address(0), new address[](0));
        }
    }

    function emergencyStopLottery() external onlyOwner {
        lotteryEnabled = false;
        emit EmergencyStop(currentRoundId);
        emit FlapLotteryTypes.LotteryPaused(true);
    }

    function cancelPendingRound(uint256 roundId) external onlyOwner {
        if (roundId != currentRoundId) revert InvalidRound();
        FlapLotteryTypes.Round storage round = rounds[roundId];
        if (round.phase != FlapLotteryTypes.RoundPhase.Prepared && round.phase != FlapLotteryTypes.RoundPhase.Drawing) {
            revert InvalidRoundPhase();
        }

        uint256 requestId = round.requestId;
        if (requestId != 0) {
            delete requestToRound[requestId];
            delete lastVRFRequestBlock[roundId];
        }
        round.requestId = 0;
        round.endTime = block.timestamp;
        round.rolloverAmount = round.totalPot;
        round.phase = FlapLotteryTypes.RoundPhase.Cancelled;
        currentRequestId = 0;
        emit RoundCancelled(roundId, requestId);
    }

    function getPrizeTier(uint8 redMatches, bool blueMatch) public pure returns (uint8) {
        if (redMatches == 6 && blueMatch) return 1;
        if (redMatches == 6) return 2;
        if (redMatches == 5 && blueMatch) return 3;
        if (redMatches == 5 || (redMatches == 4 && blueMatch)) return 4;
        if (redMatches == 4 || (redMatches == 3 && blueMatch)) return 5;
        if (blueMatch) return 6;
        return 0;
    }

    function _getOverrideAt(address user, uint256 ticketIndex, uint256 targetRound)
        internal
        view
        returns (bool exists, uint8[6] memory redBalls, uint8 blueBall)
    {
        OverrideCheckpoint[] storage history = _overrideHistory[user][ticketIndex];
        uint256 low;
        uint256 high = history.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (history[mid].fromRound <= targetRound) low = mid + 1;
            else high = mid;
        }
        if (low == 0) return (false, redBalls, 0);
        OverrideCheckpoint storage checkpoint = history[low - 1];
        return (checkpoint.exists, checkpoint.redBalls, checkpoint.blueBall);
    }

    function _writeOverrideCheckpoint(
        address user,
        uint256 ticketIndex,
        uint256 fromRound,
        uint8[6] memory redBalls,
        uint8 blueBall,
        bool exists
    ) internal {
        OverrideCheckpoint[] storage history = _overrideHistory[user][ticketIndex];
        if (history.length > 0 && history[history.length - 1].fromRound == fromRound) {
            OverrideCheckpoint storage checkpoint = history[history.length - 1];
            checkpoint.redBalls = redBalls;
            checkpoint.blueBall = blueBall;
            checkpoint.exists = exists;
        } else {
            history.push(
                OverrideCheckpoint({fromRound: fromRound, redBalls: redBalls, blueBall: blueBall, exists: exists})
            );
        }
    }

    function _validateBallNumbers(uint8[6] memory redBalls, uint8 blueBall) internal pure {
        for (uint256 i = 0; i < 6; i++) {
            if (redBalls[i] < 1 || redBalls[i] > 33) revert InvalidBallNumbers();
            if (i > 0 && redBalls[i] <= redBalls[i - 1]) revert InvalidBallNumbers();
        }
        if (blueBall < 1 || blueBall > 16) revert InvalidBallNumbers();
    }

    function _sortArray(uint8[6] memory values) internal pure returns (uint8[6] memory sorted) {
        sorted = values;
        for (uint256 i = 0; i < 6; i++) {
            for (uint256 j = i + 1; j < 6; j++) {
                if (sorted[i] > sorted[j]) (sorted[i], sorted[j]) = (sorted[j], sorted[i]);
            }
        }
    }

    function _generateRandomRedBalls(uint256 seed) internal pure returns (uint8[6] memory balls) {
        bool[34] memory used;
        for (uint256 i = 0; i < 6; i++) {
            uint8 number;
            uint256 attempts;
            do {
                number = uint8(((seed >> (i * 8)) + attempts) % 33) + 1;
                attempts++;
            } while (used[number] && attempts < 100);
            balls[i] = number;
            used[number] = true;
        }
        return _sortArray(balls);
    }

    function _matchTier(uint8[6] memory userReds, uint8 userBlue, uint8[6] memory winningReds, uint8 winningBlue)
        internal
        pure
        returns (uint8)
    {
        uint8 redMatches;
        for (uint8 i = 0; i < 6; i++) {
            for (uint8 j = 0; j < 6; j++) {
                if (userReds[i] == winningReds[j]) {
                    redMatches++;
                    break;
                }
            }
        }
        return getPrizeTier(redMatches, userBlue == winningBlue);
    }

    function _prizeFor(FlapLotteryTypes.Round storage round, uint8 tier, uint256 winnerCount)
        internal
        view
        returns (uint256 prize)
    {
        prize = (round.totalPot * _tierPercentage(tier)) / (100 * winnerCount);
        if (tier == 1 && round.jackpotBonus > 0) prize += round.jackpotBonus / winnerCount;
    }

    function _tierPercentage(uint8 tier) internal pure returns (uint256) {
        if (tier == 1) return TIER1_PERCENTAGE;
        if (tier == 2) return TIER2_PERCENTAGE;
        if (tier == 3) return TIER3_PERCENTAGE;
        if (tier == 4) return TIER4_PERCENTAGE;
        if (tier == 5) return TIER5_PERCENTAGE;
        if (tier == 6) return TIER6_PERCENTAGE;
        return 0;
    }

    function _handleOptionalVRFFunding() internal {
        if (msg.value == 0) return;
        if (msg.value < VRF_FUNDING_AMOUNT) revert InvalidAmount();

        uint256 excess = msg.value - VRF_FUNDING_AMOUNT;
        if (excess > 0) {
            totalWBNBInPot += excess;
            emit ManualPotFunding(msg.sender, excess, totalWBNBInPot);
        }
        try vrfCoordinator.deposit{value: VRF_FUNDING_AMOUNT}(subscriptionId) {
            emit FlapLotteryTypes.VRFSubscriptionFunded(subscriptionId, VRF_FUNDING_AMOUNT);
        } catch {
            totalWBNBInPot += VRF_FUNDING_AMOUNT;
            emit ManualPotFunding(msg.sender, VRF_FUNDING_AMOUNT, totalWBNBInPot);
        }
    }

    function _isTerminal(FlapLotteryTypes.RoundPhase phase) internal pure returns (bool) {
        return phase == FlapLotteryTypes.RoundPhase.Settled || phase == FlapLotteryTypes.RoundPhase.Cancelled;
    }
}
