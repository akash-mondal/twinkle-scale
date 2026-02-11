// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * SimpleVault — a basic deposit/withdraw vault with planted vulnerabilities.
 * Used as sample input for the code-audit agent category.
 */
contract SimpleVault {
    address public owner;
    mapping(address => uint256) public balances;
    address[] public depositors;
    bool public paused;

    constructor() {
        owner = msg.sender;
    }

    // VULNERABILITY: No access control — anyone can call
    function setPaused(bool _paused) external {
        paused = _paused;
    }

    function deposit() external payable {
        require(!paused, "Vault is paused");
        require(msg.value > 0, "Must deposit > 0");
        if (balances[msg.sender] == 0) {
            depositors.push(msg.sender);
        }
        balances[msg.sender] += msg.value;
    }

    // VULNERABILITY: Reentrancy — external call before state update
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // BUG: sends ETH before updating balance
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        // State update happens AFTER the external call
        balances[msg.sender] -= amount;
    }

    // VULNERABILITY: tx.origin used for authentication
    function emergencyWithdraw() external {
        require(tx.origin == owner, "Not owner");
        uint256 bal = balances[msg.sender];
        balances[msg.sender] = 0;
        payable(msg.sender).transfer(bal);
    }

    // VULNERABILITY: Unbounded loop — excessive gas if depositors array grows large
    function distributeRewards() external payable {
        require(msg.value > 0, "No rewards to distribute");
        uint256 totalDeposited = address(this).balance - msg.value;
        require(totalDeposited > 0, "No deposits");

        for (uint256 i = 0; i < depositors.length; i++) {
            uint256 share = (msg.value * balances[depositors[i]]) / totalDeposited;
            // NOTE: In Solidity < 0.8, this multiplication could silently overflow.
            // Even in 0.8+, the pattern is fragile with large arrays and rounding.
            payable(depositors[i]).transfer(share);
        }
    }

    // VULNERABILITY: No access control on selfdestruct successor
    function destroy(address payable recipient) external {
        require(msg.sender == owner, "Not owner");
        selfdestruct(recipient);
    }

    receive() external payable {
        balances[msg.sender] += msg.value;
    }
}
