// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface RawVrfConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract FlapSettlementE2EToken is ERC20 {
    address public constant taxProcessor = address(0);
    address public constant mainPool = address(0);
    constructor() ERC20("Settlement E2E Token", "SETTLE") {
        _mint(msg.sender, 1_000_000_000 ether);
    }
}

contract FlapSettlementE2EVrf {
    uint256 public lastRequestId;

    function requestRandomWords(bytes32, uint64, uint16, uint32, uint32) external returns (uint256) {
        return ++lastRequestId;
    }

    function getSubscription(uint64) external pure returns (uint96, uint64, address, address[] memory consumers) {
        return (1 ether, 0, address(0), new address[](0));
    }

    function deposit(uint64) external payable {}

    function fulfill(address lottery, uint256 requestId, uint256[] calldata randomWords) external {
        RawVrfConsumer(lottery).rawFulfillRandomWords(requestId, randomWords);
    }
}

contract FlapSettlementE2EMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory results) {
        results = new Result[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory returnData) = calls[i].target.call(calls[i].callData);
            if (!calls[i].allowFailure && !success) revert("Multicall3 call failed");
            results[i] = Result(success, returnData);
        }
    }
}
