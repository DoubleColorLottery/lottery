// SPDX-License-Identifier: MIT
// Reference: GoPlus SafeToken Factory
// Source: https://etherscan.io/address/0x0d648ED434f95f812e6A0E9b74825bAD03579027
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

interface IToken {
    function initialize(string memory _symbol, string memory _name, uint256 _totalSupply,
                       address _owner, address _dest) external;
}

interface ISafeTokenFactory {
    event TokenCreated(
        uint256 indexed tempKey,
        address indexed token,
        string symbol,
        string name,
        uint256 totalSupply,
        address owner,
        address dest
    );
    event TemplateUpdated(uint256 indexed tempKey, address indexed template);

    function cumputeTokenAddress(uint256 tempKey_) external view returns (address tokenAddress);
    function createToken(uint256 tempKey_, string memory symbol_, string memory name_,
                        uint256 totalSupply_, address owner_, address dest_) external returns (address token);
}

/// @title SafeTokenFactory
/// @notice Factory for deploying EIP-1167 minimal proxy tokens
/// @dev Uses deterministic deployment for predictable addresses
contract SafeTokenFactory is ISafeTokenFactory, Ownable {
    /// @notice Template implementations by key (1 = TokenTemplate)
    mapping(uint256 => address) public templates;

    /// @notice Nonce per creator for deterministic deployment
    mapping(address => uint) public nonces;

    constructor() Ownable(_msgSender()) {}

    /// @notice Predict token address before deployment
    /// @param tempKey_ Template key (1 for standard token)
    /// @return tokenAddress The address the token will be deployed at
    function cumputeTokenAddress(
        uint256 tempKey_
    ) external override view returns (address tokenAddress) {
        tokenAddress = Clones.predictDeterministicAddress(
            templates[tempKey_],
            keccak256(abi.encode(_msgSender(), nonces[_msgSender()] + 1))
        );
    }

    /// @notice Deploy a new token using a template
    /// @param tempKey_ Template key (1 for standard token)
    /// @param symbol_ Token symbol
    /// @param name_ Token name
    /// @param totalSupply_ Total supply to mint
    /// @param owner_ Token contract owner
    /// @param dest_ Address to receive initial mint
    /// @return token The deployed token address
    function createToken(
        uint256 tempKey_,
        string memory symbol_,
        string memory name_,
        uint256 totalSupply_,
        address owner_,
        address dest_
    ) external override returns (address token) {
        require(templates[tempKey_] != address(0), "Template not exists");
        require(owner_ != address(0) && dest_ != address(0), "Zero Address");

        nonces[_msgSender()]++;

        // Deploy minimal proxy clone
        token = Clones.cloneDeterministic(
            templates[tempKey_],
            keccak256(abi.encode(_msgSender(), nonces[_msgSender()]))
        );

        // Initialize the token
        IToken(token).initialize(symbol_, name_, totalSupply_, owner_, dest_);

        emit TokenCreated(
            tempKey_,
            token,
            symbol_,
            name_,
            totalSupply_,
            owner_,
            dest_
        );
    }

    /// @notice Register or update a template implementation
    /// @param tempKey_ Template key
    /// @param template_ Implementation address
    function updateTemplates(
        uint256 tempKey_,
        address template_
    ) external onlyOwner {
        templates[tempKey_] = template_;
        emit TemplateUpdated(tempKey_, template_);
    }
}
