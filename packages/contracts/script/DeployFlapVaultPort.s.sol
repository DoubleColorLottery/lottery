// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {DeployConfig} from "./DeployConfig.sol";
import {FlapDoubleBallLottery} from "../src/lottery/FlapDoubleBallLottery.sol";
import {LotteryRevenueVault} from "../src/vault/LotteryRevenueVault.sol";
import {LotteryRevenueVaultFactory} from "../src/vault/LotteryRevenueVaultFactory.sol";
import {IFlapTaxTokenV3} from "../src/flap/IFlapTaxTokenV3.sol";
import {ITaxProcessor, PackedFeeConfig} from "../src/flap/ITaxProcessor.sol";
import {IPortalTypes, IPortalCommonTypes} from "../src/flap/IPortal.sol";
import {IVaultPortal, IVaultPortalTypes} from "../src/flap/IVaultPortal.sol";

/// @notice Deploys the lottery and factory around a predicted address, then launches the Flap token.
contract DeployFlapVaultPort is Script, DeployConfig {
    address internal constant PORTAL = 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0;
    address payable internal constant VAULT_PORTAL = payable(0x90497450f2a706f1951b5bdda52B4E5d16f34C06);
    address internal constant TOKEN_IMPL_TAXED_V3 = 0x024f18294970B5c76c0691b87f138A0317156422;

    struct Deployment {
        address token;
        address lottery;
        address vault;
        address factory;
        address taxProcessor;
        uint64 subscriptionId;
    }

    function run() external returns (Deployment memory deployment) {
        require(block.chainid == 56, "Flap vault port deployment currently targets BSC mainnet");
        Config memory chain = getConfig();
        bytes32 salt = vm.envBytes32("FLAP_TOKEN_SALT");
        address signer = vm.envAddress("ELIGIBILITY_SIGNER_ADDRESS");
        string memory name = vm.envOr("FLAP_TOKEN_NAME", string("DoubleBall"));
        string memory symbol = vm.envOr("FLAP_TOKEN_SYMBOL", string("DOUBLEBALL"));
        string memory meta = vm.envOr("FLAP_TOKEN_META_URI", string(""));
        uint16 buyTaxRate = uint16(vm.envOr("FLAP_BUY_TAX_BPS", uint256(500)));
        uint16 sellTaxRate = uint16(vm.envOr("FLAP_SELL_TAX_BPS", uint256(500)));
        uint64 taxDuration = uint64(vm.envOr("FLAP_TAX_DURATION_SECONDS", uint256(100 * 365 days)));
        uint64 antiFarmerDuration = uint64(vm.envOr("FLAP_ANTI_FARMER_SECONDS", uint256(1 days)));
        uint256 quoteAmount = vm.envOr("FLAP_INITIAL_BUY_WEI", uint256(0));

        require(signer != address(0), "Eligibility signer is required");
        require(buyTaxRate > 0 && sellTaxRate > 0, "Buy and sell tax must be non-zero");
        address predictedToken = Clones.predictDeterministicAddress(TOKEN_IMPL_TAXED_V3, salt, PORTAL);
        require(uint16(uint160(predictedToken)) == 0x7777, "Salt must predict a token ending in 7777");

        vm.startBroadcast();
        LotteryRevenueVaultFactory factory = new LotteryRevenueVaultFactory();
        FlapDoubleBallLottery lottery =
            new FlapDoubleBallLottery(predictedToken, chain.vrfCoordinator, 0, chain.keyHash, signer);

        IVaultPortalTypes.NewTokenV6WithVaultParams memory params = IVaultPortalTypes.NewTokenV6WithVaultParams({
            name: name,
            symbol: symbol,
            meta: meta,
            dexThresh: IPortalCommonTypes.DexThreshType.FOUR_FIFTHS,
            salt: salt,
            migratorType: IPortalTypes.MigratorType.V2_MIGRATOR,
            quoteToken: address(0),
            quoteAmt: quoteAmount,
            permitData: "",
            extensionID: bytes32(0),
            extensionData: "",
            dexId: IPortalTypes.DEXId.DEX0,
            lpFeeProfile: IPortalTypes.V3LPFeeProfile.LP_FEE_PROFILE_STANDARD,
            buyTaxRate: buyTaxRate,
            sellTaxRate: sellTaxRate,
            taxDuration: taxDuration,
            antiFarmerDuration: antiFarmerDuration,
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
        address token = IVaultPortal(VAULT_PORTAL).newTokenV6WithVault{value: quoteAmount}(params);
        IVaultPortalTypes.VaultInfo memory info = IVaultPortal(VAULT_PORTAL).getVault(token);

        uint64 subscriptionId = lottery.createVRFSubscription();
        lottery.setExcludedFromTickets(lottery.owner(), true);
        lottery.setLotteryEnabled(true);
        vm.stopBroadcast();

        require(token == predictedToken, "Flap deployed an unexpected token address");
        require(info.vaultFactory == address(factory), "Vault factory registration mismatch");
        LotteryRevenueVault vault = LotteryRevenueVault(payable(info.vault));
        require(vault.taxToken() == token, "Vault token binding mismatch");
        require(vault.lottery() == address(lottery), "Vault lottery binding mismatch");
        require(vault.vaultQuoteToken() == address(0), "Vault quote token mismatch");

        address processor = IFlapTaxTokenV3(token).taxProcessor();
        require(ITaxProcessor(processor).marketAddress() == address(vault), "Processor market binding mismatch");
        PackedFeeConfig memory feeConfig = ITaxProcessor(processor).feeConfig();
        require(
            feeConfig.marketBps == 10_000 && feeConfig.deflationBps == 0 && feeConfig.lpBps == 0
                && feeConfig.dividendBps == 0,
            "Processor allocation mismatch"
        );

        deployment = Deployment({
            token: token,
            lottery: address(lottery),
            vault: address(vault),
            factory: address(factory),
            taxProcessor: processor,
            subscriptionId: subscriptionId
        });

        console2.log("Token", deployment.token);
        console2.log("Lottery", deployment.lottery);
        console2.log("Vault", deployment.vault);
        console2.log("Vault factory", deployment.factory);
        console2.log("Tax processor", deployment.taxProcessor);
        console2.log("VRF subscription", deployment.subscriptionId);
    }
}

