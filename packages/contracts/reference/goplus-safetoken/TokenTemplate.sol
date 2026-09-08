// SPDX-License-Identifier: MIT
// Reference: GoPlus SafeToken Template
// Source: https://etherscan.io/address/0x24A9eB23De8E6f59BDB981B03E847F0f3ABbFa0d
pragma solidity 0.8.20;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";

interface IToken {
    function initialize(string memory _symbol, string memory _name, uint256 _totalSupply,
                       address _owner, address _dest) external;
}

contract TokenTemplate is IToken, ERC20Upgradeable, ERC20PermitUpgradeable, OwnableUpgradeable {
    mapping (address => bool) blacklist;
    mapping (address => bool) whitelist;
    mapping (address => bool) pools;

    uint256 constant DENOMINATOR = 10000;
    address public initialRecipient;

    uint256 public buyTax;
    uint256 public sellTax;
    address public taxReceiver;

    bool public hasTax = true;
    bool public hasBlacklist = true;
    bool public hasDevInit = false;

    event BlackListDisabled();
    event TaxDisabled();

    /// @notice Initialize the token (called by factory via proxy)
    /// @param symbol_ Token symbol
    /// @param name_ Token name
    /// @param totalSupply_ Total supply to mint
    /// @param owner_ Contract owner
    /// @param dest_ Address to receive initial mint
    function initialize(
        string memory symbol_,
        string memory name_,
        uint256 totalSupply_,
        address owner_,
        address dest_
    ) external initializer {
        _transferOwnership(owner_);
        __ERC20_init(name_, symbol_);
        _mint(dest_, totalSupply_);
        initialRecipient = dest_;
    }

    /// @notice Configure blacklist, whitelist, pools, and taxes (one-time setup)
    /// @param blacks_ Addresses to blacklist (max 10)
    /// @param whites_ Addresses to whitelist (max 10)
    /// @param pool_ DEX pool addresses for tax application
    /// @param buyTax_ Buy tax in basis points (max 500 = 5%)
    /// @param sellTax_ Sell tax in basis points (max 500 = 5%)
    /// @param taxReceiver_ Address to receive tax
    function devInit(
        address[] calldata blacks_,
        address[] calldata whites_,
        address[] calldata pool_,
        uint256 buyTax_,
        uint256 sellTax_,
        address taxReceiver_
    ) external onlyOwner {
        require(!hasDevInit, "Already Initialized");
        require(blacks_.length <= 10, "Too many black addresses");
        require(whites_.length <= 10, "Too many white addresses");
        require(buyTax_ <= 500 && sellTax_ <= 500, "Tax must lte 5%");

        for(uint256 i = blacks_.length; i > 0; ) {
            unchecked { i--; }
            require(blacks_[i] != initialRecipient && blacks_[i] != taxReceiver_, "Can't be blocked");
            blacklist[blacks_[i]] = true;
        }

        for(uint256 i = whites_.length; i > 0; ) {
            unchecked { i--; }
            whitelist[whites_[i]] = true;
        }

        for(uint256 i = pool_.length; i > 0; ) {
            unchecked { i--; }
            pools[pool_[i]] = true;
        }

        buyTax = buyTax_;
        sellTax = sellTax_;
        taxReceiver = taxReceiver_;
        hasDevInit = true;
    }

    /// @notice Transfer with tax and blacklist enforcement
    function _transfer(address from, address to, uint256 amount) internal override {
        // Whitelisted addresses bypass all restrictions
        if(whitelist[from] || whitelist[to]) {
            return super._transfer(from, to, amount);
        }

        // Check blacklist
        if(hasBlacklist) {
            require(!blacklist[from] && !blacklist[to], "Address is blocked");
        }

        // Apply tax on DEX trades
        if(hasTax) {
            uint256 taxAmount = 0;
            if(pools[from]) {
                // Buy from DEX
                taxAmount = amount * buyTax / DENOMINATOR;
            }
            else if(pools[to]) {
                // Sell to DEX
                taxAmount = amount * sellTax / DENOMINATOR;
            }
            if(taxAmount > 0) {
                super._transfer(from, taxReceiver, taxAmount);
                amount -= taxAmount;
            }
        }

        super._transfer(from, to, amount);
    }

    /// @notice Burn tokens
    function burn(uint256 amount) public virtual {
        _burn(_msgSender(), amount);
    }

    /// @notice Permanently disable blacklist (irreversible)
    function removeBlacklist() external onlyOwner {
        hasBlacklist = false;
        emit BlackListDisabled();
    }

    /// @notice Permanently disable tax (irreversible)
    function removeTax() external onlyOwner {
        hasTax = false;
        emit TaxDisabled();
    }
}
