// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../../script/DeployConfig.sol";

contract DeployConfigTest is Test {
    DeployConfig internal config;

    function setUp() public {
        config = new DeployConfig();
    }

    function test_GetConfigUsesBscMainnet() public {
        vm.chainId(56);

        DeployConfig.Config memory selected = config.getConfig();

        assertEq(selected.chainId, 56);
        assertEq(selected.pancakeRouter, 0x10ED43C718714eb63d5aA57B78B54704E256024E);
        assertEq(selected.wbnb, 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c);
    }

    function test_GetConfigUsesBscTestnet() public {
        vm.chainId(97);

        DeployConfig.Config memory selected = config.getConfig();

        assertEq(selected.chainId, 97);
        assertEq(selected.pancakeRouter, 0xD99D1c33F9fC3444f8101754aBC46c52416550D1);
        assertEq(selected.wbnb, 0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd);
    }

    function test_GetConfigRejectsUnsupportedChain() public {
        vm.chainId(31337);
        vm.expectRevert(abi.encodeWithSelector(DeployConfig.UnsupportedChain.selector, 31337));

        config.getConfig();
    }

    function test_GetConfigByChainIdRejectsUnsupportedChain() public {
        vm.expectRevert(abi.encodeWithSelector(DeployConfig.UnsupportedChain.selector, 1));

        config.getConfigByChainId(1);
    }
}
