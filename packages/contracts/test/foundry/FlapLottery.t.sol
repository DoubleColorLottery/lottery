// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {FlapDoubleBallLottery} from "src/lottery/FlapDoubleBallLottery.sol";
import {FlapLotteryTypes} from "src/lottery/FlapLotteryTypes.sol";
import {LotteryRevenueVault} from "src/vault/LotteryRevenueVault.sol";
import {LotteryRevenueVaultFactory} from "src/vault/LotteryRevenueVaultFactory.sol";

contract MockFlapToken is ERC20 {
    constructor() ERC20("Flap Lottery Token", "FLT") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

contract MockFlapVRFCoordinator {
    uint256 public lastRequestId;
    uint256 public deposits;

    function requestRandomWords(bytes32, uint64, uint16, uint32, uint32) external returns (uint256) {
        return ++lastRequestId;
    }

    function fulfill(address lottery, uint256 requestId, uint256[] memory words) external {
        (bool success,) =
            lottery.call(abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", requestId, words));
        require(success, "fulfillment failed");
    }

    function createSubscription() external pure returns (uint64) {
        return 1;
    }

    function addConsumer(uint64, address) external pure {}

    function getSubscription(uint64) external pure returns (uint96, uint64, address, address[] memory consumers) {
        return (1 ether, 0, address(0), new address[](0));
    }

    function deposit(uint64) external payable {
        deposits += msg.value;
    }
}

contract FlapLotteryTest is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant OTHER_SIGNER_KEY = 0xB0B;
    bytes32 internal constant KEY_HASH = keccak256("key-hash");
    bytes32 internal constant MANIFEST_HASH = keccak256("manifest");
    uint256 internal constant ROUND_BLOCK = 9_985;
    bytes32 internal constant ROUND_BLOCK_HASH = keccak256("block-9985");
    address internal constant VAULT_PORTAL = 0x90497450f2a706f1951b5bdda52B4E5d16f34C06;

    MockFlapToken internal token;
    MockFlapVRFCoordinator internal vrf;
    FlapDoubleBallLottery internal lottery;
    address internal signer;
    address internal alice;
    address internal bob;

    function setUp() public {
        signer = vm.addr(SIGNER_KEY);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        token = new MockFlapToken();
        vrf = new MockFlapVRFCoordinator();
        lottery = new FlapDoubleBallLottery(address(token), address(vrf), 1, KEY_HASH, signer);

        token.transfer(alice, 20_000 ether);
        token.transfer(bob, 10_000 ether);
        lottery.setLotteryEnabled(true);
        vm.roll(10_000);
        vm.setBlockhash(ROUND_BLOCK, ROUND_BLOCK_HASH);
    }

    function test_PrepareRoundFreezesEligibilityAndPot() public {
        _fundPot(100 ether);
        uint256 roundId = _prepareRound(2, 15);
        FlapLotteryTypes.Round memory round = lottery.getRound(roundId);

        assertEq(roundId, 1);
        assertEq(uint8(round.phase), uint8(FlapLotteryTypes.RoundPhase.Prepared));
        assertEq(round.eligibilityBlock, ROUND_BLOCK);
        assertEq(round.eligibilityBlockHash, ROUND_BLOCK_HASH);
        assertEq(round.eligibilitySigner, signer);
        assertEq(round.manifestHash, MANIFEST_HASH);
        assertEq(round.eligibleHolderCount, 2);
        assertEq(round.totalEligibleTickets, 15);
        assertEq(round.totalPot, 100 ether);
        assertTrue(round.eligibilitySetId != bytes32(0));
        assertTrue(lottery.lotteryInProgress());
    }

    function test_PrepareRoundRejectsBadBlockAndSummary() public {
        vm.expectRevert(FlapDoubleBallLottery.InvalidEligibilityBlock.selector);
        lottery.prepareRound(ROUND_BLOCK, bytes32(uint256(1)), MANIFEST_HASH, 2, 15);

        vm.expectRevert(FlapDoubleBallLottery.InvalidEligibilitySummary.selector);
        lottery.prepareRound(ROUND_BLOCK, ROUND_BLOCK_HASH, MANIFEST_HASH, 0, 0);

        vm.expectRevert(FlapDoubleBallLottery.InvalidEligibilitySummary.selector);
        lottery.prepareRound(ROUND_BLOCK, ROUND_BLOCK_HASH, bytes32(0), 2, 15);
    }

    function test_RequestDrawRequiresPreparedRoundAndTransitionsToDrawn() public {
        vm.expectRevert(FlapDoubleBallLottery.InvalidRoundPhase.selector);
        lottery.requestDraw(0);

        uint256 roundId = _prepareRound(2, 15);
        uint256 requestId = lottery.requestDraw(roundId);
        assertEq(requestId, 1);
        assertEq(uint8(lottery.getRound(roundId).phase), uint8(FlapLotteryTypes.RoundPhase.Drawing));

        _fulfill(requestId);
        FlapLotteryTypes.Round memory round = lottery.getRound(roundId);
        assertEq(uint8(round.phase), uint8(FlapLotteryTypes.RoundPhase.Drawn));
        assertEq(round.redBalls[0], 1);
        assertEq(round.redBalls[5], 6);
        assertEq(round.blueBall, 7);
        assertFalse(lottery.lotteryInProgress());
    }

    function test_EligibilitySignatureRegistersDerivedTicketCount() public {
        uint256 roundId = _prepareRound(2, 15);
        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);

        assertTrue(lottery.verifyEligibility(claim, signature));
        assertEq(lottery.registerEligibility(claim, signature), 10);
        assertEq(lottery.registeredEligibleBalance(roundId, alice), 20_000 ether);
        assertEq(lottery.registeredTicketCount(roundId, alice), 10);
        assertEq(lottery.registerEligibility(claim, ""), 10);
    }

    function test_EligibilityRejectsWrongSignerAccountBalanceAndDomain() public {
        uint256 roundId = _prepareRound(2, 15);
        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);

        (, bytes memory wrongSignerSignature) = _signedClaim(roundId, alice, 20_000 ether, OTHER_SIGNER_KEY);
        assertFalse(lottery.verifyEligibility(claim, wrongSignerSignature));

        FlapLotteryTypes.EligibilityClaim memory altered = claim;
        altered.account = bob;
        assertFalse(lottery.verifyEligibility(altered, signature));

        altered = claim;
        altered.eligibleBalance++;
        assertFalse(lottery.verifyEligibility(altered, signature));

        FlapDoubleBallLottery otherLottery =
            new FlapDoubleBallLottery(address(token), address(vrf), 1, KEY_HASH, signer);
        bytes32 otherDigest = otherLottery.eligibilityDigest(claim);
        bytes memory otherDomainSignature = _signDigest(SIGNER_KEY, otherDigest);
        assertFalse(lottery.verifyEligibility(claim, otherDomainSignature));
    }

    function test_SignerRotationOnlyAffectsFutureRounds() public {
        uint256 roundId = _prepareRound(2, 15);
        address nextSigner = vm.addr(OTHER_SIGNER_KEY);
        lottery.setEligibilitySigner(nextSigner);

        (FlapLotteryTypes.EligibilityClaim memory oldClaim, bytes memory oldSignature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);
        assertTrue(lottery.verifyEligibility(oldClaim, oldSignature));

        (, bytes memory newSignature) = _signedClaim(roundId, alice, 20_000 ether, OTHER_SIGNER_KEY);
        assertFalse(lottery.verifyEligibility(oldClaim, newSignature));
    }

    function test_PostCutoffTransferDoesNotChangeRegisteredEligibility() public {
        uint256 roundId = _prepareRound(2, 15);
        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);

        token.transfer(alice, 20_000 ether);
        assertEq(lottery.getTicketCount(alice), 20);
        assertEq(lottery.registerEligibility(claim, signature), 10);
    }

    function test_TicketDerivationMatchesServerVector() public {
        vm.chainId(56);
        FlapDoubleBallLottery vectorLottery =
            new FlapDoubleBallLottery(address(token), address(vrf), 1, KEY_HASH, signer);
        vm.etch(address(0x4444444444444444444444444444444444444444), address(vectorLottery).code);

        (uint8[6] memory redBalls, uint8 blueBall) = FlapDoubleBallLottery(
                payable(0x4444444444444444444444444444444444444444)
            ).deriveTicket(0x1111111111111111111111111111111111111111, 7, 2);
        uint8[6] memory expected = [uint8(5), 7, 9, 11, 27, 33];
        for (uint256 i = 0; i < 6; i++) {
            assertEq(redBalls[i], expected[i]);
        }
        assertEq(blueBall, 1);
    }

    function test_ConflictingEligibilityCannotReplaceCachedCount() public {
        uint256 roundId = _prepareRound(2, 15);
        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);
        lottery.registerEligibility(claim, signature);

        (FlapLotteryTypes.EligibilityClaim memory conflicting, bytes memory conflictingSignature) =
            _signedClaim(roundId, alice, 18_000 ether, SIGNER_KEY);
        vm.expectRevert(FlapDoubleBallLottery.EligibilityAlreadyRegistered.selector);
        lottery.registerEligibility(conflicting, conflictingSignature);
    }

    function test_EligibilityRegistrationCannotExceedFrozenManifestTotals() public {
        uint256 roundId = _prepareRound(2, 15);
        (FlapLotteryTypes.EligibilityClaim memory aliceClaim, bytes memory aliceSignature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);
        lottery.registerEligibility(aliceClaim, aliceSignature);

        (FlapLotteryTypes.EligibilityClaim memory bobClaim, bytes memory bobSignature) =
            _signedClaim(roundId, bob, 12_000 ether, SIGNER_KEY);
        vm.expectRevert(FlapDoubleBallLottery.EligibilityCapacityExceeded.selector);
        lottery.registerEligibility(bobClaim, bobSignature);

        assertEq(lottery.registeredHolderCount(roundId), 1);
        assertEq(lottery.registeredTicketsTotal(roundId), 10);
    }

    function test_OverrideAndExclusionChangesAfterPreparationAffectNextRoundOnly() public {
        uint8[6] memory firstNumbers = [uint8(1), 2, 3, 4, 5, 6];
        uint8[6] memory nextNumbers = [uint8(8), 9, 10, 11, 12, 13];

        vm.prank(alice);
        lottery.changeTicketNumbers(0, firstNumbers, 7);
        uint256 roundId = _prepareRound(2, 15);

        vm.prank(alice);
        lottery.changeTicketNumbers(0, nextNumbers, 8);
        lottery.setExcludedFromTickets(alice, true);

        (uint8[6] memory roundOneReds, uint8 roundOneBlue) = lottery.getTicket(alice, roundId, 0);
        (uint8[6] memory roundTwoReds, uint8 roundTwoBlue) = lottery.getTicket(alice, roundId + 1, 0);
        for (uint256 i = 0; i < 6; i++) {
            assertEq(roundOneReds[i], firstNumbers[i]);
        }
        assertEq(roundOneBlue, 7);
        for (uint256 i = 0; i < 6; i++) {
            assertEq(roundTwoReds[i], nextNumbers[i]);
        }
        assertEq(roundTwoBlue, 8);
        assertFalse(lottery.isExcludedAt(alice, roundId));
        assertTrue(lottery.isExcludedAt(alice, roundId + 1));
    }

    function test_FullRoundPaysSignedEligibleWinner() public {
        uint8[6] memory winningReds = [uint8(1), 2, 3, 4, 5, 6];
        vm.prank(alice);
        lottery.changeTicketNumbers(0, winningReds, 7);
        _fundPot(100 ether);

        uint256 roundId = _prepareRound(2, 15);
        uint256 requestId = lottery.requestDraw(roundId);
        _fulfill(requestId);

        uint256[6] memory winnerCounts;
        winnerCounts[0] = 1;
        lottery.settleRound(roundId, winnerCounts);

        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        lottery.claimWinnings(roundId, 0, claim, signature);

        assertEq(alice.balance - balanceBefore, 33.25 ether);
        assertTrue(lottery.ticketClaimed(roundId, alice, 0));
        assertEq(lottery.getRound(roundId).totalClaimed, 33.25 ether);
    }

    function test_SettlementRejectsMoreWinnersThanEligibleTickets() public {
        uint256 roundId = _prepareRound(2, 15);
        uint256 requestId = lottery.requestDraw(roundId);
        _fulfill(requestId);

        uint256[6] memory winnerCounts;
        winnerCounts[0] = 8;
        winnerCounts[1] = 8;
        vm.expectRevert(FlapDoubleBallLottery.InvalidWinnerCounts.selector);
        lottery.settleRound(roundId, winnerCounts);
    }

    function test_ClaimRejectsCertificateForAnotherAccountAndReplay() public {
        uint8[6] memory winningReds = [uint8(1), 2, 3, 4, 5, 6];
        vm.prank(alice);
        lottery.changeTicketNumbers(0, winningReds, 7);
        _fundPot(100 ether);
        uint256 roundId = _completeDrawWithTierOneWinner();

        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);
        vm.expectRevert(FlapDoubleBallLottery.InvalidEligibility.selector);
        vm.prank(bob);
        lottery.claimWinnings(roundId, 0, claim, signature);

        vm.prank(alice);
        lottery.claimWinnings(roundId, 0, claim, signature);
        vm.expectRevert(FlapDoubleBallLottery.AlreadyClaimed.selector);
        vm.prank(alice);
        lottery.claimWinnings(roundId, 0, claim, "");
    }

    function test_CancelledRoundKeepsPotAndRejectsEligibility() public {
        _fundPot(10 ether);
        uint256 roundId = _prepareRound(2, 15);
        lottery.cancelPendingRound(roundId);

        FlapLotteryTypes.Round memory round = lottery.getRound(roundId);
        assertEq(uint8(round.phase), uint8(FlapLotteryTypes.RoundPhase.Cancelled));
        assertEq(lottery.totalWBNBInPot(), 10 ether);
        assertFalse(lottery.lotteryInProgress());

        (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature) =
            _signedClaim(roundId, alice, 20_000 ether, SIGNER_KEY);
        assertFalse(lottery.verifyEligibility(claim, signature));
    }

    function test_RequestDrawOptionalFundingSeparatesExcessForNextRound() public {
        _fundPot(10 ether);
        uint256 roundId = _prepareRound(2, 15);
        vm.deal(address(this), 1 ether);
        lottery.requestDraw{value: 0.015 ether}(roundId);

        assertEq(vrf.deposits(), 0.005 ether);
        assertEq(lottery.totalWBNBInPot(), 10.01 ether);
        assertEq(lottery.getRound(roundId).totalPot, 10 ether);
    }

    function test_VaultRevenueFundsCurrentAndFutureRoundPots() public {
        vm.chainId(56);
        LotteryRevenueVaultFactory factory = new LotteryRevenueVaultFactory();
        vm.prank(VAULT_PORTAL);
        LotteryRevenueVault vault = LotteryRevenueVault(
            payable(factory.newVault(address(token), address(0), address(this), abi.encode(address(lottery))))
        );

        vm.deal(address(this), 3 ether);
        (bool firstDeposit,) = address(vault).call{value: 2 ether}("");
        assertTrue(firstDeposit);
        assertEq(vault.flush(), 2 ether);
        assertEq(lottery.totalWBNBInPot(), 2 ether);

        uint256 roundId = _prepareRound(2, 15);
        assertEq(lottery.getRound(roundId).totalPot, 2 ether);

        (bool secondDeposit,) = address(vault).call{value: 1 ether}("");
        assertTrue(secondDeposit);
        assertEq(vault.flush(), 1 ether);
        assertEq(lottery.getRound(roundId).totalPot, 2 ether);
        assertEq(lottery.totalWBNBInPot(), 3 ether);
    }

    function _prepareRound(uint256 holders, uint256 tickets) internal returns (uint256) {
        return lottery.prepareRound(ROUND_BLOCK, ROUND_BLOCK_HASH, MANIFEST_HASH, holders, tickets);
    }

    function _completeDrawWithTierOneWinner() internal returns (uint256 roundId) {
        roundId = _prepareRound(2, 15);
        uint256 requestId = lottery.requestDraw(roundId);
        _fulfill(requestId);
        uint256[6] memory winnerCounts;
        winnerCounts[0] = 1;
        lottery.settleRound(roundId, winnerCounts);
    }

    function _fulfill(uint256 requestId) internal {
        uint256[] memory words = new uint256[](7);
        for (uint256 i = 0; i < 7; i++) {
            words[i] = i;
        }
        vrf.fulfill(address(lottery), requestId, words);
    }

    function _signedClaim(uint256 roundId, address account, uint256 balance, uint256 privateKey)
        internal
        view
        returns (FlapLotteryTypes.EligibilityClaim memory claim, bytes memory signature)
    {
        claim = FlapLotteryTypes.EligibilityClaim({
            roundId: roundId,
            account: account,
            eligibleBalance: balance,
            eligibilitySetId: lottery.getRound(roundId).eligibilitySetId
        });
        signature = _signDigest(privateKey, lottery.eligibilityDigest(claim));
    }

    function _signDigest(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _fundPot(uint256 amount) internal {
        vm.deal(address(this), amount);
        lottery.fundPot{value: amount}();
    }

    receive() external payable {}
}
