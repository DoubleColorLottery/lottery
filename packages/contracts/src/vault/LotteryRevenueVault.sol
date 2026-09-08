// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin-contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {VaultBaseV3} from "../flap/VaultBaseV3.sol";
import {ApproveAction, FieldDescriptor, VaultMethodSchema, VaultUISchema} from "../flap/IVaultSchemasV1.sol";

interface ILotteryRevenueSink {
    function fundPot() external payable;
}

/// @title LotteryRevenueVault
/// @notice Flap V3 vault that recognizes native BNB tax revenue and forwards it to one lottery.
contract LotteryRevenueVault is Initializable, VaultBaseV3, ReentrancyGuardUpgradeable {
    address public taxToken;
    address public lottery;
    uint256 public accountedQuote;

    address private _quoteToken;

    event RevenueRecognized(uint256 amount, uint256 accountedTotal);
    event RevenueFlushed(address indexed lottery, uint256 amount);

    /// @dev The implementation is never used directly. Each vault is a BeaconProxy.
    constructor() {
        _disableInitializers();
    }

    function initialize(address predictedTaxToken, address quoteToken_, address lottery_) external initializer {
        require(
            predictedTaxToken != address(0) && lottery_ != address(0) && lottery_.code.length > 0, "Invalid address"
        );
        require(quoteToken_ == address(0), "Only native BNB is supported");

        __ReentrancyGuard_init();
        taxToken = predictedTaxToken;
        lottery = lottery_;
        _quoteToken = quoteToken_;
    }

    /// @inheritdoc VaultBaseV3
    function vaultQuoteToken() public view override returns (address) {
        return _quoteToken;
    }

    /// @notice Recognize native revenue delivered by Flap or by a direct transfer.
    receive() external payable {
        _syncRevenue();
    }

    /// @notice Recognize any balance that arrived without a successful wake call.
    function sync() external returns (uint256 recognized) {
        return _syncRevenue();
    }

    /// @notice Forward every recognized wei to the configured lottery.
    /// @dev This is permissionless so revenue never depends on an operator key.
    function flush() external nonReentrant returns (uint256 amount) {
        _syncRevenue();
        amount = accountedQuote;
        if (amount == 0) return 0;

        accountedQuote = 0;
        (bool success,) = lottery.call{value: amount}(abi.encodeCall(ILotteryRevenueSink.fundPot, ()));
        require(success, "Revenue forwarding failed");

        emit RevenueFlushed(lottery, amount);
    }

    /// @notice Revenue available for the next flush, including an unrecognized direct transfer.
    function pendingRevenue() external view returns (uint256) {
        return address(this).balance;
    }

    function description() public view override returns (string memory) {
        if (address(this).balance == 0) {
            return "DoubleBall lottery vault: all recognized BNB revenue has been forwarded.";
        }
        return "DoubleBall lottery vault: BNB tax revenue is ready to be forwarded to the prize pot.";
    }

    function vaultUISchema() public pure override returns (VaultUISchema memory schema) {
        schema.vaultType = "DoubleBallLotteryRevenue";
        schema.description =
        "Receives BNB tax revenue from a Flap token and forwards it to the linked DoubleBall lottery prize pot.";
        schema.methods = new VaultMethodSchema[](5);

        schema.methods[0].name = "lottery";
        schema.methods[0].description = "Returns the immutable lottery revenue recipient.";
        schema.methods[0].inputs = new FieldDescriptor[](0);
        schema.methods[0].outputs = new FieldDescriptor[](1);
        schema.methods[0].outputs[0] = FieldDescriptor("lottery", "address", "Lottery contract", 0);
        schema.methods[0].approvals = new ApproveAction[](0);

        schema.methods[1].name = "vaultQuoteToken";
        schema.methods[1].description = "Returns the revenue currency. Zero address means native BNB.";
        schema.methods[1].inputs = new FieldDescriptor[](0);
        schema.methods[1].outputs = new FieldDescriptor[](1);
        schema.methods[1].outputs[0] = FieldDescriptor("quoteToken", "address", "Revenue currency", 0);
        schema.methods[1].approvals = new ApproveAction[](0);

        schema.methods[2].name = "pendingRevenue";
        schema.methods[2].description = "Returns all BNB currently available to forward.";
        schema.methods[2].inputs = new FieldDescriptor[](0);
        schema.methods[2].outputs = new FieldDescriptor[](1);
        schema.methods[2].outputs[0] = FieldDescriptor("amount", "uint256", "Pending BNB", 18);
        schema.methods[2].approvals = new ApproveAction[](0);

        schema.methods[3].name = "sync";
        schema.methods[3].description = "Recognizes BNB that arrived without a wake call.";
        schema.methods[3].inputs = new FieldDescriptor[](0);
        schema.methods[3].outputs = new FieldDescriptor[](1);
        schema.methods[3].outputs[0] = FieldDescriptor("recognized", "uint256", "Newly recognized BNB", 18);
        schema.methods[3].approvals = new ApproveAction[](0);
        schema.methods[3].isWriteMethod = true;

        schema.methods[4].name = "flush";
        schema.methods[4].description = "Forwards all pending BNB to the lottery prize pot.";
        schema.methods[4].inputs = new FieldDescriptor[](0);
        schema.methods[4].outputs = new FieldDescriptor[](1);
        schema.methods[4].outputs[0] = FieldDescriptor("amount", "uint256", "Forwarded BNB", 18);
        schema.methods[4].approvals = new ApproveAction[](0);
        schema.methods[4].isWriteMethod = true;
    }

    function _syncRevenue() internal returns (uint256 recognized) {
        uint256 balance = address(this).balance;
        if (balance <= accountedQuote) return 0;

        recognized = balance - accountedQuote;
        accountedQuote = balance;
        emit RevenueRecognized(recognized, balance);
    }

    uint256[46] private __gap;
}
