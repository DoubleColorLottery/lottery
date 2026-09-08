// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {LotteryRevenueVault} from "./LotteryRevenueVault.sol";
import {IVaultFactoryValidationV2} from "../flap/IVaultFactory.sol";
import {IPortalTypes} from "../flap/IPortal.sol";
import {VaultFactoryBaseV2} from "../flap/VaultFactoryBaseV2.sol";
import {FieldDescriptor, VaultDataSchema} from "../flap/IVaultSchemasV1.sol";

interface ILotteryLaunchBinding {
    function owner() external view returns (address);
    function taxToken() external view returns (address);
}

/// @title LotteryRevenueVaultFactory
/// @notice Flap factory for Guardian-upgradeable native-BNB lottery revenue vaults.
contract LotteryRevenueVaultFactory is VaultFactoryBaseV2 {
    address public immutable beacon;

    constructor() {
        LotteryRevenueVault implementation = new LotteryRevenueVault();
        beacon = address(new UpgradeableBeacon(address(implementation), address(this)));
    }

    function newVault(address taxToken, address quoteToken, address creator, bytes calldata vaultData)
        external
        override
        returns (address vault)
    {
        require(msg.sender == _getVaultPortal(), "Only VaultPortal");
        require(quoteToken == address(0), "Only native BNB is supported");

        address lottery = abi.decode(vaultData, (address));
        require(taxToken != address(0) && lottery != address(0) && lottery.code.length > 0, "Invalid lottery");

        address lotteryOwner = ILotteryLaunchBinding(lottery).owner();
        require(lotteryOwner == creator, "Lottery owner must be token creator");

        address configuredToken = ILotteryLaunchBinding(lottery).taxToken();
        require(configuredToken == taxToken, "Lottery token must match predicted token");

        vault = address(
            new BeaconProxy(beacon, abi.encodeCall(LotteryRevenueVault.initialize, (taxToken, quoteToken, lottery)))
        );
    }

    function isQuoteTokenSupported(address quoteToken) external pure override returns (bool supported) {
        return quoteToken == address(0);
    }

    function factorySpecVersion() public pure override returns (string memory) {
        return "v2.3";
    }

    function _validateBeforeLaunch(IVaultFactoryValidationV2.LaunchValidationDataV1 memory data)
        internal
        pure
        override
        returns (bool success, string memory reason)
    {
        if (data.tokenVersion != IPortalTypes.TokenVersion.TOKEN_TAXED_V3) {
            return (false, "DoubleBall requires Flap Tax Token V3.");
        }
        if (data.quoteToken != address(0)) {
            return (false, "DoubleBall currently supports native BNB only.");
        }
        if (data.buyTaxRate == 0 || data.sellTaxRate == 0) {
            return (false, "DoubleBall requires non-zero buy and sell tax.");
        }
        if (data.vaultBps != 10_000 || data.deflationBps != 0 || data.dividendBps != 0 || data.lpBps != 0) {
            return (false, "All distributable tax must be assigned to the lottery vault.");
        }
        return (true, "");
    }

    function upgradeVaultImplementation(address newImplementation) external {
        require(msg.sender == _getGuardian(), "Only Guardian");
        require(newImplementation.code.length > 0, "Invalid implementation");
        UpgradeableBeacon(beacon).upgradeTo(newImplementation);
    }

    function lockVaultUpgrades() external {
        require(msg.sender == _getGuardian(), "Only Guardian");
        UpgradeableBeacon(beacon).renounceOwnership();
    }

    function isVaultUpgradesLocked() external view returns (bool) {
        return UpgradeableBeacon(beacon).owner() == address(0);
    }

    function beaconImplementation() external view returns (address) {
        return UpgradeableBeacon(beacon).implementation();
    }

    function vaultDataSchema() public pure override returns (VaultDataSchema memory schema) {
        schema.description =
        "Creates a native-BNB revenue vault linked to a predeployed DoubleBall lottery owned by the token creator.";
        schema.fields = new FieldDescriptor[](1);
        schema.fields[0] = FieldDescriptor("lottery", "address", "Predeployed DoubleBall lottery contract", 0);
        schema.isArray = false;
    }
}
