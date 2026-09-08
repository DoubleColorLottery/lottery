// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LotteryRevenueVault} from "src/vault/LotteryRevenueVault.sol";
import {LotteryRevenueVaultFactory} from "src/vault/LotteryRevenueVaultFactory.sol";
import {IVaultFactory, IVaultFactoryValidationV2} from "src/flap/IVaultFactory.sol";
import {IPortalTypes} from "src/flap/IPortal.sol";
import {VaultDataSchema, VaultUISchema} from "src/flap/IVaultSchemasV1.sol";

contract MockLotteryRevenueSink {
    address public owner;
    address public taxToken;
    uint256 public funded;
    bool public rejectFunding;
    address public reenterVault;

    constructor(address owner_, address taxToken_) {
        owner = owner_;
        taxToken = taxToken_;
    }

    function setRejectFunding(bool reject) external {
        rejectFunding = reject;
    }

    function setReenterVault(address vault) external {
        reenterVault = vault;
    }

    function fundPot() external payable {
        if (rejectFunding) revert("funding rejected");
        funded += msg.value;

        if (reenterVault != address(0)) {
            (bool reentered,) = reenterVault.call(abi.encodeCall(LotteryRevenueVault.flush, ()));
            require(!reentered, "flush reentrancy unexpectedly succeeded");
        }
    }
}

contract FlapRevenueVaultTest is Test {
    uint256 internal constant BSC_CHAIN_ID = 56;
    address internal constant VAULT_PORTAL = 0x90497450f2a706f1951b5bdda52B4E5d16f34C06;
    address internal constant GUARDIAN = 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b;
    address internal constant TAX_TOKEN = address(0x7777);
    address internal constant CREATOR = address(0xC0FFEE);

    LotteryRevenueVaultFactory internal factory;
    LotteryRevenueVault internal vault;
    MockLotteryRevenueSink internal lottery;

    function setUp() public {
        vm.chainId(BSC_CHAIN_ID);
        lottery = new MockLotteryRevenueSink(CREATOR, TAX_TOKEN);
        factory = new LotteryRevenueVaultFactory();

        vm.prank(VAULT_PORTAL);
        vault = LotteryRevenueVault(
            payable(factory.newVault(TAX_TOKEN, address(0), CREATOR, abi.encode(address(lottery))))
        );
    }

    function test_FactoryDeploysInitializedBeaconProxy() public view {
        assertEq(vault.taxToken(), TAX_TOKEN);
        assertEq(vault.lottery(), address(lottery));
        assertEq(vault.vaultQuoteToken(), address(0));
        assertEq(vault.vaultSpecVersion(), "v3");
        assertEq(factory.factorySpecVersion(), "v2.3");
        assertTrue(factory.beaconImplementation() != address(0));
    }

    function test_ImplementationAndProxyCannotBeInitializedAgain() public {
        address implementation = factory.beaconImplementation();

        vm.expectRevert(bytes("Initializable: contract is already initialized"));
        LotteryRevenueVault(payable(implementation)).initialize(TAX_TOKEN, address(0), address(lottery));

        vm.expectRevert(bytes("Initializable: contract is already initialized"));
        vault.initialize(TAX_TOKEN, address(0), address(lottery));
    }

    function test_ReceiveRecognizesRevenueWithinGasBudget() public {
        vm.deal(address(this), 1 ether);
        uint256 gasBefore = gasleft();
        (bool success,) = address(vault).call{value: 1 ether}("");
        uint256 gasUsed = gasBefore - gasleft();

        assertTrue(success);
        assertEq(vault.accountedQuote(), 1 ether);
        assertLt(gasUsed, 100_000);
    }

    function test_ZeroValueWakeAndRepeatedSyncAreNoOps() public {
        (bool success,) = address(vault).call("");
        assertTrue(success);
        assertEq(vault.accountedQuote(), 0);
        assertEq(vault.sync(), 0);
        assertEq(vault.sync(), 0);
    }

    function test_SyncRecognizesDirectDonation() public {
        vm.deal(address(vault), 2 ether);

        assertEq(vault.accountedQuote(), 0);
        assertEq(vault.sync(), 2 ether);
        assertEq(vault.accountedQuote(), 2 ether);
        assertEq(vault.sync(), 0);
    }

    function test_FlushForwardsAllRevenueAndDecrementsBaseline() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(vault).call{value: 1 ether}("");
        assertTrue(success);

        assertEq(vault.flush(), 1 ether);
        assertEq(vault.accountedQuote(), 0);
        assertEq(address(vault).balance, 0);
        assertEq(lottery.funded(), 1 ether);
        assertEq(vault.flush(), 0);

        vm.deal(address(this), 0.25 ether);
        (success,) = address(vault).call{value: 0.25 ether}("");
        assertTrue(success);
        assertEq(vault.accountedQuote(), 0.25 ether);
        assertEq(vault.flush(), 0.25 ether);
        assertEq(lottery.funded(), 1.25 ether);
    }

    function test_FailedFlushPreservesBalanceAndAccounting() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(vault).call{value: 1 ether}("");
        assertTrue(success);
        lottery.setRejectFunding(true);

        vm.expectRevert(bytes("Revenue forwarding failed"));
        vault.flush();

        assertEq(vault.accountedQuote(), 1 ether);
        assertEq(address(vault).balance, 1 ether);
        assertEq(lottery.funded(), 0);
    }

    function test_FlushCannotBeReentered() public {
        vm.deal(address(this), 1 ether);
        (bool success,) = address(vault).call{value: 1 ether}("");
        assertTrue(success);
        lottery.setReenterVault(address(vault));

        assertEq(vault.flush(), 1 ether);
        assertEq(lottery.funded(), 1 ether);
        assertEq(vault.accountedQuote(), 0);
    }

    function test_FactoryRejectsNonPortalAndBadBindings() public {
        vm.expectRevert(bytes("Only VaultPortal"));
        factory.newVault(TAX_TOKEN, address(0), CREATOR, abi.encode(address(lottery)));

        vm.expectRevert(bytes("Only native BNB is supported"));
        vm.prank(VAULT_PORTAL);
        factory.newVault(TAX_TOKEN, address(1), CREATOR, abi.encode(address(lottery)));

        vm.expectRevert(bytes("Lottery owner must be token creator"));
        vm.prank(VAULT_PORTAL);
        factory.newVault(TAX_TOKEN, address(0), address(1), abi.encode(address(lottery)));

        MockLotteryRevenueSink wrongToken = new MockLotteryRevenueSink(CREATOR, address(2));
        vm.expectRevert(bytes("Lottery token must match predicted token"));
        vm.prank(VAULT_PORTAL);
        factory.newVault(TAX_TOKEN, address(0), CREATOR, abi.encode(address(wrongToken)));
    }

    function test_FactoryValidationMatchesProductConstraints() public view {
        IVaultFactoryValidationV2.LaunchValidationDataV1 memory data;
        data.tokenVersion = IPortalTypes.TokenVersion.TOKEN_TAXED_V3;
        data.quoteToken = address(0);
        data.buyTaxRate = 500;
        data.sellTaxRate = 500;
        data.vaultBps = 10_000;

        (bool valid, string memory reason) = factory.onBeforeLaunch(abi.encode(data));
        assertTrue(valid);
        assertEq(reason, "");

        data.quoteToken = address(1);
        (valid, reason) = factory.onBeforeLaunch(abi.encode(data));
        assertFalse(valid);
        assertEq(reason, "DoubleBall currently supports native BNB only.");

        data.quoteToken = address(0);
        data.dividendBps = 1;
        (valid, reason) = factory.onBeforeLaunch(abi.encode(data));
        assertFalse(valid);
        assertEq(reason, "All distributable tax must be assigned to the lottery vault.");
    }

    function test_SchemasDescribeTheFactoryAndVault() public view {
        VaultDataSchema memory factorySchema = factory.vaultDataSchema();
        assertEq(factorySchema.fields.length, 1);
        assertEq(factorySchema.fields[0].name, "lottery");
        assertFalse(factorySchema.isArray);

        VaultUISchema memory vaultSchema = vault.vaultUISchema();
        assertEq(vaultSchema.vaultType, "DoubleBallLotteryRevenue");
        assertEq(vaultSchema.methods.length, 5);
        assertEq(vaultSchema.methods[4].name, "flush");
        assertTrue(vaultSchema.methods[4].isWriteMethod);
    }

    function test_DescriptionReflectsPendingRevenue() public {
        assertEq(vault.description(), "DoubleBall lottery vault: all recognized BNB revenue has been forwarded.");
        vm.deal(address(this), 1 ether);
        (bool success,) = address(vault).call{value: 1 ether}("");
        assertTrue(success);
        assertEq(
            vault.description(), "DoubleBall lottery vault: BNB tax revenue is ready to be forwarded to the prize pot."
        );
        vault.flush();
        assertEq(vault.description(), "DoubleBall lottery vault: all recognized BNB revenue has been forwarded.");
    }

    function test_OnlyGuardianCanUpgradeAndLockBeacon() public {
        LotteryRevenueVault nextImplementation = new LotteryRevenueVault();

        vm.expectRevert(bytes("Only Guardian"));
        factory.upgradeVaultImplementation(address(nextImplementation));

        vm.expectRevert(bytes("Only Guardian"));
        factory.lockVaultUpgrades();

        vm.expectRevert(bytes("Invalid implementation"));
        vm.prank(GUARDIAN);
        factory.upgradeVaultImplementation(address(1));

        vm.prank(GUARDIAN);
        factory.upgradeVaultImplementation(address(nextImplementation));
        assertEq(factory.beaconImplementation(), address(nextImplementation));

        vm.prank(GUARDIAN);
        factory.lockVaultUpgrades();
        assertTrue(factory.isVaultUpgradesLocked());

        LotteryRevenueVault lockedImplementation = new LotteryRevenueVault();
        vm.expectRevert();
        vm.prank(GUARDIAN);
        factory.upgradeVaultImplementation(address(lockedImplementation));
    }
}
