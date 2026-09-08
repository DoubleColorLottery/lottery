// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {FlapDoubleBallLottery} from "src/lottery/FlapDoubleBallLottery.sol";
import {LotteryRevenueVault} from "src/vault/LotteryRevenueVault.sol";
import {LotteryRevenueVaultFactory} from "src/vault/LotteryRevenueVaultFactory.sol";
import {IFlapTaxTokenV3} from "src/flap/IFlapTaxTokenV3.sol";
import {ITaxProcessor, PackedFeeConfig} from "src/flap/ITaxProcessor.sol";
import {IPortalTypes, IPortalCommonTypes, IPortalTradeV2} from "src/flap/IPortal.sol";
import {IVaultPortal, IVaultPortalTypes} from "src/flap/IVaultPortal.sol";

contract FlapForkVRFCoordinator {
    function requestRandomWords(bytes32, uint64, uint16, uint32, uint32) external pure returns (uint256) {
        return 1;
    }

    function createSubscription() external pure returns (uint64) {
        return 1;
    }

    function addConsumer(uint64, address) external pure {}

    function getSubscription(uint64) external pure returns (uint96, uint64, address, address[] memory consumers) {
        return (1 ether, 0, address(0), new address[](0));
    }

    function deposit(uint64) external payable {}
}

/// @notice End-to-end launch and revenue test against the deployed BSC Flap protocol.
contract FlapVaultPortalForkTest is Test {
    address internal constant PORTAL = 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0;
    address payable internal constant VAULT_PORTAL = payable(0x90497450f2a706f1951b5bdda52B4E5d16f34C06);
    address internal constant TOKEN_IMPL_TAXED_V3 = 0x024f18294970B5c76c0691b87f138A0317156422;
    bytes32 internal constant SALT = 0xafa095a04e18c20d707652f96d769afc487d491fae89b98407572779b2290d7f;
    bytes32 internal constant KEY_HASH = keccak256("fork-key-hash");

    LotteryRevenueVaultFactory internal factory;
    FlapDoubleBallLottery internal lottery;
    LotteryRevenueVault internal vault;
    address internal token;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BSC_RPC_URL", vm.rpcUrl("bsc_mainnet"));
        try vm.createSelectFork(rpcUrl) {}
        catch {
            vm.skip(true);
        }

        address predictedToken = Clones.predictDeterministicAddress(TOKEN_IMPL_TAXED_V3, SALT, PORTAL);
        assertEq(predictedToken, 0x3CAF2731d86FBfDFf57b2cC362e12BD1C6557777);

        factory = new LotteryRevenueVaultFactory();
        FlapForkVRFCoordinator vrf = new FlapForkVRFCoordinator();
        lottery = new FlapDoubleBallLottery(predictedToken, address(vrf), 1, KEY_HASH, address(0xA11CE));

        IVaultPortalTypes.NewTokenV6WithVaultParams memory params = IVaultPortalTypes.NewTokenV6WithVaultParams({
            name: "DoubleBall Flap Fork",
            symbol: "DBFF",
            meta: "",
            dexThresh: IPortalCommonTypes.DexThreshType.FOUR_FIFTHS,
            salt: SALT,
            migratorType: IPortalTypes.MigratorType.V2_MIGRATOR,
            quoteToken: address(0),
            quoteAmt: 0,
            permitData: "",
            extensionID: bytes32(0),
            extensionData: "",
            dexId: IPortalTypes.DEXId.DEX0,
            lpFeeProfile: IPortalTypes.V3LPFeeProfile.LP_FEE_PROFILE_STANDARD,
            buyTaxRate: 500,
            sellTaxRate: 500,
            taxDuration: uint64(100 * 365 days),
            antiFarmerDuration: uint64(1 days),
            mktBps: 10_000,
            deflationBps: 0,
            dividendBps: 0,
            lpBps: 0,
            minimumShareBalance: 0,
            dividendToken: address(0),
            commissionReceiver: address(0),
            tokenVersion: IPortalTypes.TokenVersion.TOKEN_TAXED_V3,
            vaultFactory: address(factory),
            vaultData: abi.encode(address(lottery))
        });

        token = IVaultPortal(VAULT_PORTAL).newTokenV6WithVault(params);
        IVaultPortalTypes.VaultInfo memory info = IVaultPortal(VAULT_PORTAL).getVault(token);
        vault = LotteryRevenueVault(payable(info.vault));
    }

    function test_LivePortalLaunchAndBondingCurveRevenueReachLottery() public {
        assertEq(token, address(lottery.taxToken()));
        assertEq(vault.taxToken(), token);
        assertEq(vault.lottery(), address(lottery));
        assertEq(vault.vaultQuoteToken(), address(0));

        address processor = IFlapTaxTokenV3(token).taxProcessor();
        assertEq(ITaxProcessor(processor).marketAddress(), address(vault));
        PackedFeeConfig memory config = ITaxProcessor(processor).feeConfig();
        assertEq(ITaxProcessor(processor).getQuoteToken(), 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c);
        assertTrue(config.isWeth);
        assertEq(config.marketBps, 10_000);
        assertEq(config.deflationBps, 0);
        assertEq(config.lpBps, 0);
        assertEq(config.dividendBps, 0);

        address buyer = makeAddr("flap-buyer");
        vm.deal(buyer, 2 ether);
        vm.startPrank(buyer);
        IPortalTradeV2.ExactInputParams memory trade = IPortalTradeV2.ExactInputParams({
            inputToken: address(0), outputToken: token, inputAmount: 1 ether, minOutputAmount: 0, permitData: ""
        });
        IPortalTradeV2(PORTAL).swapExactInput{value: 1 ether}(trade);
        vm.stopPrank();

        uint256 pending = ITaxProcessor(processor).marketQuoteBalance();
        assertGt(pending, 0);
        ITaxProcessor(processor).dispatch{gas: 1_000_000}();
        assertEq(vault.pendingRevenue(), pending);
        assertEq(vault.flush(), pending);
        assertEq(lottery.totalWBNBInPot(), pending);
    }
}
