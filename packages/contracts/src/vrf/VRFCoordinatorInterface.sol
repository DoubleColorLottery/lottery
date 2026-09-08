// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title VRF协调器接口
interface VRFCoordinatorInterface {
    function getRequestConfig()
        external
        view
        returns (uint16, uint32, bytes32[] memory);

    /// @notice 请求随机数
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);

    /// @notice 创建订阅
    function createSubscription() external returns (uint64 subId);

    /// @notice 充值订阅
    function deposit(uint64 subId) external payable;

    /// @notice 获取订阅信息
    function getSubscription(uint64 subId)
        external
        view
        returns (
            uint96 balance,
            uint64 reqCount,
            address owner,
            address[] memory consumers
        );

    function requestSubscriptionOwnerTransfer(uint64 subId, address newOwner) external;

    function acceptSubscriptionOwnerTransfer(uint64 subId) external;

    /// @notice 添加消费者
    function addConsumer(uint64 subId, address consumer) external;

    /// @notice 移除消费者
    function removeConsumer(uint64 subId, address consumer) external;

    /// @notice 取消订阅
    function cancelSubscription(uint64 subId, address to) external;

    /// @notice 检查是否有待处理请求
    function pendingRequestExists(uint64 subId) external view returns (bool);
}
