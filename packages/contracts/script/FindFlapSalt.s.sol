// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @notice Finds a 7777 vanity salt for the current BSC Flap V3 token implementation.
contract FindFlapSalt is Script {
    address internal constant PORTAL = 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0;
    address internal constant TOKEN_IMPL_TAXED_V3 = 0x024f18294970B5c76c0691b87f138A0317156422;

    function run() external view returns (bytes32 salt, address predictedToken) {
        salt = vm.envOr("FLAP_SALT_SEED", keccak256(abi.encode("doubleball-flap-vault-port")));
        while (true) {
            predictedToken = Clones.predictDeterministicAddress(TOKEN_IMPL_TAXED_V3, salt, PORTAL);
            if (uint16(uint160(predictedToken)) == 0x7777) break;
            salt = bytes32(uint256(salt) + 1);
        }
        console2.logBytes32(salt);
        console2.log("Predicted token", predictedToken);
    }
}
