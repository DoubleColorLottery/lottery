// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title DeployConfig
/// @notice Network configuration shared by the Flap deployment scripts.
contract DeployConfig {
    error UnsupportedChain(uint256 chainId);

    struct Config {
        address vrfCoordinator;
        bytes32 keyHash;
        address pancakeRouter;
        address wbnb;
        uint256 chainId;
    }

    Config public bscMainnet = Config({
        vrfCoordinator: 0x9632ADE542f12114f5E5AD4d6F8e47fB993955da,
        keyHash: 0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4,
        pancakeRouter: 0x10ED43C718714eb63d5aA57B78B54704E256024E,
        wbnb: 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c,
        chainId: 56
    });

    Config public bscTestnet = Config({
        vrfCoordinator: 0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053,
        keyHash: 0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80,
        pancakeRouter: 0xD99D1c33F9fC3444f8101754aBC46c52416550D1,
        wbnb: 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd,
        chainId: 97
    });

    function getConfig() public view returns (Config memory) {
        if (block.chainid == 56) {
            return bscMainnet;
        }
        if (block.chainid == 97) {
            return bscTestnet;
        }
        revert UnsupportedChain(block.chainid);
    }

    function getConfigByChainId(uint256 chainId) public view returns (Config memory) {
        if (chainId == 56) {
            return bscMainnet;
        }
        if (chainId == 97) {
            return bscTestnet;
        }
        revert UnsupportedChain(chainId);
    }
}
