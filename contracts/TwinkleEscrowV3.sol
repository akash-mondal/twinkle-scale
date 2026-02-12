// SPDX-License-Identifier: MIT
pragma solidity >=0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import { BITE } from "@skalenetwork/bite-solidity/BITE.sol";
import { IBiteSupplicant } from "@skalenetwork/bite-solidity/interfaces/IBiteSupplicant.sol";

/// @title TwinkleEscrowV3 — Conditional escrow with BITE CTX auto-settlement
/// @notice Quality-gated escrow with two settlement paths:
///
///   Flow A — Manual settlement:
///     1. Buyer creates escrow with `createEscrow()`
///     2. Buyer settles with `verifyAndSettle(escrowId, qualityScore)`
///     3. Score >= 5 → provider PAID; score < 5 → buyer REFUNDED
///
///   Flow B — BITE CTX auto-settlement:
///     1. Buyer creates escrow with `createEncryptedEscrow()`
///     2. Buyer calls `initiateAutoSettle(escrowId, encryptedScore)` with ETH for CTX gas
///     3. BITE validators decrypt the score and call `onDecrypt()` in block N+1
///     4. Contract auto-settles based on decrypted quality score
///
/// @dev Requires EVM version istanbul and Solidity >=0.8.27 for BITE compatibility.
///      Uses official @skalenetwork/bite-solidity library.
///      SUBMIT_CTX precompile at address(0x1B).
contract TwinkleEscrowV3 is Ownable, ReentrancyGuard, IBiteSupplicant {
    using SafeERC20 for IERC20;
    using Address for address payable;

    // ── Constants ───────────────────────────────────────────────────────────

    /// @notice Quality score threshold: >= this value means provider gets paid
    uint8 public constant QUALITY_THRESHOLD = 5;

    /// @notice Default escrow timeout (1 hour)
    uint256 public constant DEFAULT_TIMEOUT = 1 hours;

    /// @notice Emergency refund available after 2x timeout
    uint256 public constant EMERGENCY_TIMEOUT_MULTIPLIER = 2;

    /// @notice Gas limit for CTX callback execution
    uint256 public constant CTX_GAS_LIMIT = 500000;

    // ── Enums ───────────────────────────────────────────────────────────────

    enum Status {
        Pending,   // 0 — funds deposited, awaiting settlement
        Settled,   // 1 — provider paid (quality met threshold)
        Refunded   // 2 — buyer refunded (quality below threshold or timeout)
    }

    // ── Structs ─────────────────────────────────────────────────────────────

    struct Escrow {
        address buyer;
        address provider;
        address token;
        uint256 amount;
        bytes32 metadataHash;
        Status  status;
        uint256 createdAt;
        address ctxSender;          // callback sender address from submitCTX
        bool    autoSettleInitiated;
    }

    // ── State ───────────────────────────────────────────────────────────────

    mapping(address => bool) public allowedTokens;
    uint256 public maxEscrowAmount;
    uint256 public escrowTimeout;
    mapping(uint256 => Escrow) public escrows;
    uint256 public escrowCount;

    // ── Events ──────────────────────────────────────────────────────────────

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        bytes32 metadataHash
    );

    event EscrowSettled(uint256 indexed escrowId, uint8 qualityScore);
    event EscrowRefunded(uint256 indexed escrowId);
    event AutoSettleInitiated(uint256 indexed escrowId, address ctxSender);
    event AutoSettleExecuted(uint256 indexed escrowId, uint8 qualityScore, string action);

    // ── Errors ──────────────────────────────────────────────────────────────

    error TokenNotAllowed(address token);
    error ExceedsMaxAmount(uint256 amount, uint256 max);
    error ZeroAmount();
    error ZeroAddress();
    error InvalidEscrowId(uint256 escrowId);
    error NotBuyer(address caller, address buyer);
    error EscrowNotPending(uint256 escrowId, Status current);
    error EscrowNotExpired(uint256 escrowId, uint256 deadline);
    error EmergencyTimeoutNotReached(uint256 escrowId, uint256 emergencyDeadline);
    error AutoSettleAlreadyInitiated(uint256 escrowId);
    error UnauthorizedCallback(address caller, address expected);

    // ── Constructor ─────────────────────────────────────────────────────────

    constructor(uint256 _maxEscrowAmount) Ownable(msg.sender) {
        maxEscrowAmount = _maxEscrowAmount;
        escrowTimeout = DEFAULT_TIMEOUT;
    }

    // ── Receive ─────────────────────────────────────────────────────────────

    /// @notice Accept ETH for CTX gas funding
    receive() external payable {}

    // ── Owner Configuration ─────────────────────────────────────────────────

    function setMaxEscrowAmount(uint256 _amount) external onlyOwner {
        maxEscrowAmount = _amount;
    }

    function setAllowedToken(address _token, bool _allowed) external onlyOwner {
        if (_token == address(0)) revert ZeroAddress();
        allowedTokens[_token] = _allowed;
    }

    function setEscrowTimeout(uint256 _timeout) external onlyOwner {
        require(_timeout > 0, "Timeout must be > 0");
        escrowTimeout = _timeout;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  FLOW A — Manual Escrow
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Create a standard escrow. Buyer deposits tokens.
    function createEscrow(
        address provider,
        address token,
        uint256 amount,
        bytes32 metadataHash
    ) external nonReentrant returns (uint256 escrowId) {
        _validateEscrowParams(provider, token, amount);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        escrowId = escrowCount++;
        escrows[escrowId] = Escrow({
            buyer: msg.sender,
            provider: provider,
            token: token,
            amount: amount,
            metadataHash: metadataHash,
            status: Status.Pending,
            createdAt: block.timestamp,
            ctxSender: address(0),
            autoSettleInitiated: false
        });

        emit EscrowCreated(escrowId, msg.sender, provider, amount, metadataHash);
    }

    /// @notice Manual settlement — buyer provides quality score.
    function verifyAndSettle(
        uint256 escrowId,
        uint8 qualityScore
    ) external nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);
        _settleByScore(escrowId, e, qualityScore);
    }

    /// @notice Buyer claims refund after timeout.
    function claimRefund(uint256 escrowId) external nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);

        uint256 deadline = e.createdAt + escrowTimeout;
        if (block.timestamp <= deadline) revert EscrowNotExpired(escrowId, deadline);

        e.status = Status.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(escrowId);
    }

    /// @notice Owner emergency refund after 2x timeout.
    function emergencyRefund(uint256 escrowId) external onlyOwner nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);

        uint256 emergencyDeadline = e.createdAt + (escrowTimeout * EMERGENCY_TIMEOUT_MULTIPLIER);
        if (block.timestamp <= emergencyDeadline) {
            revert EmergencyTimeoutNotReached(escrowId, emergencyDeadline);
        }

        e.status = Status.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(escrowId);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  FLOW B — BITE CTX Auto-Settlement
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Create an escrow and immediately submit a CTX for auto-settlement.
    ///         The encrypted quality score will be decrypted by BITE validators
    ///         and `onDecrypt()` will be called in block N+1 to settle.
    ///
    /// @param provider         Service provider address
    /// @param token            ERC-20 token for escrow
    /// @param amount           Escrow amount
    /// @param metadataHash     Hash of off-chain metadata
    /// @param encryptedScore   BITE-encrypted quality score (encrypted via bite.encryptMessage)
    ///
    /// @dev Caller must send ETH to cover CTX gas: msg.value covers the callback execution.
    ///      Gas limit = msg.value / tx.gasprice.
    function createAndAutoSettle(
        address provider,
        address token,
        uint256 amount,
        bytes32 metadataHash,
        bytes calldata encryptedScore
    ) external payable nonReentrant returns (uint256 escrowId) {
        _validateEscrowParams(provider, token, amount);
        require(encryptedScore.length > 0, "Empty encrypted score");
        require(msg.value > 0, "Must send ETH for CTX gas");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        escrowId = escrowCount++;
        escrows[escrowId] = Escrow({
            buyer: msg.sender,
            provider: provider,
            token: token,
            amount: amount,
            metadataHash: metadataHash,
            status: Status.Pending,
            createdAt: block.timestamp,
            ctxSender: address(0),
            autoSettleInitiated: true
        });

        emit EscrowCreated(escrowId, msg.sender, provider, amount, metadataHash);

        // Submit CTX with encrypted score
        _submitSettlementCTX(escrowId, encryptedScore);
    }

    /// @notice Submit a CTX to auto-settle an existing pending escrow.
    /// @param escrowId        The escrow to auto-settle
    /// @param encryptedScore  BITE-encrypted quality score
    function initiateAutoSettle(
        uint256 escrowId,
        bytes calldata encryptedScore
    ) external payable nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);
        if (e.autoSettleInitiated) revert AutoSettleAlreadyInitiated(escrowId);
        require(encryptedScore.length > 0, "Empty encrypted score");
        require(msg.value > 0, "Must send ETH for CTX gas");

        e.autoSettleInitiated = true;
        _submitSettlementCTX(escrowId, encryptedScore);
    }

    /// @notice BITE CTX callback — called by the callback sender in block N+1.
    ///         Decodes the decrypted quality score and settles the escrow.
    /// @param decryptedArguments  Array containing: [0] = decrypted quality score byte
    /// @param plaintextArguments  Array containing: [0] = ABI-encoded escrow ID
    function onDecrypt(
        bytes[] calldata decryptedArguments,
        bytes[] calldata plaintextArguments
    ) external override nonReentrant {
        // Decode escrow ID from plaintext args
        uint256 escrowId = abi.decode(plaintextArguments[0], (uint256));

        Escrow storage e = _getValidEscrow(escrowId);

        // Verify caller is the stored CTX callback sender
        if (msg.sender != e.ctxSender) {
            revert UnauthorizedCallback(msg.sender, e.ctxSender);
        }

        require(e.autoSettleInitiated, "Auto-settle not initiated");

        // Decode quality score from decrypted args (single byte: 0-10)
        uint8 qualityScore = uint8(bytes1(decryptedArguments[0]));
        require(qualityScore <= 10, "Invalid quality score");

        // Settle based on quality threshold
        string memory action;
        if (qualityScore >= QUALITY_THRESHOLD) {
            e.status = Status.Settled;
            IERC20(e.token).safeTransfer(e.provider, e.amount);
            action = "PAID";
            emit EscrowSettled(escrowId, qualityScore);
        } else {
            e.status = Status.Refunded;
            IERC20(e.token).safeTransfer(e.buyer, e.amount);
            action = "REFUNDED";
            emit EscrowRefunded(escrowId);
        }

        emit AutoSettleExecuted(escrowId, qualityScore, action);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  View Functions
    // ════════════════════════════════════════════════════════════════════════

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        return escrows[escrowId];
    }

    function isExpired(uint256 escrowId) external view returns (bool) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        return block.timestamp > escrows[escrowId].createdAt + escrowTimeout;
    }

    function getDeadline(uint256 escrowId) external view returns (uint256) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        return escrows[escrowId].createdAt + escrowTimeout;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Internal Helpers
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Submit a CTX for escrow settlement via BITE precompile
    function _submitSettlementCTX(
        uint256 escrowId,
        bytes calldata encryptedScore
    ) internal {
        // Encrypted args: the quality score (decrypted by BITE validators)
        bytes[] memory encryptedArgs = new bytes[](1);
        encryptedArgs[0] = encryptedScore;

        // Plaintext args: escrow ID (passed through unchanged for callback identification)
        bytes[] memory plaintextArgs = new bytes[](1);
        plaintextArgs[0] = abi.encode(escrowId);

        // Submit CTX — returns the callback sender address
        address payable callbackSender = BITE.submitCTX(
            BITE.SUBMIT_CTX_ADDRESS,
            msg.value / tx.gasprice,
            encryptedArgs,
            plaintextArgs
        );

        // Store callback sender for verification in onDecrypt
        escrows[escrowId].ctxSender = callbackSender;

        // Fund the callback sender with ETH for CTX gas execution
        callbackSender.sendValue(msg.value);

        emit AutoSettleInitiated(escrowId, callbackSender);
    }

    function _validateEscrowParams(
        address provider,
        address token,
        uint256 amount
    ) internal view {
        if (provider == address(0)) revert ZeroAddress();
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (!allowedTokens[token]) revert TokenNotAllowed(token);
        if (amount > maxEscrowAmount) revert ExceedsMaxAmount(amount, maxEscrowAmount);
    }

    function _getValidEscrow(uint256 escrowId) internal view returns (Escrow storage e) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        e = escrows[escrowId];
        if (e.status != Status.Pending) revert EscrowNotPending(escrowId, e.status);
    }

    function _settleByScore(
        uint256 escrowId,
        Escrow storage e,
        uint8 qualityScore
    ) internal {
        if (qualityScore >= QUALITY_THRESHOLD) {
            e.status = Status.Settled;
            IERC20(e.token).safeTransfer(e.provider, e.amount);
            emit EscrowSettled(escrowId, qualityScore);
        } else {
            e.status = Status.Refunded;
            IERC20(e.token).safeTransfer(e.buyer, e.amount);
            emit EscrowRefunded(escrowId);
        }
    }
}
