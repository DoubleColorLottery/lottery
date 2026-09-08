// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title VRF消费者基类
/// @notice 使用VRF随机数的合约必须继承此合约
abstract contract VRFConsumerBase {
    address private immutable vrfCoordinator;

    error OnlyCoordinatorCanFulfill(address have, address want);

    constructor(address _vrfCoordinator) {
        vrfCoordinator = _vrfCoordinator;
    }

    /// @notice 子类重写此函数处理VRF响应
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;

    /// @notice VRF协调器收到有效VRF证明后调用此函数
    /// @dev 验证发送者是VRF协调器
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != vrfCoordinator) {
            revert OnlyCoordinatorCanFulfill(msg.sender, vrfCoordinator);
        }
        fulfillRandomWords(requestId, randomWords);
    }

    /// @notice 获取VRF协调器地址
    function getVRFCoordinator() public view returns (address) {
        return vrfCoordinator;
    }
}
