// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ============================================================================
//  BITE V2 Precompile Interface
//  Deployed at: 0x0000000000000000000000000000000000000100
// ============================================================================

/// @title IBITEV2 — Interface for the BITE V2 precompile on SKALE
/// @notice Provides confidential transaction execution (CTX) via threshold encryption.
///         `decryptAndExecute` schedules a CTX for block N+1. The CTX is sent by a
///         one-time random wallet W (returned by `getRandomWalletForCTX`). Contracts
///         that receive the CTX implement `onDecrypt(decryptedArgs, plainArgs)` where
///         `msg.sender` is wallet W — NOT the precompile address.
interface IBITEV2 {
    /// @notice Schedule a confidential transaction for execution in block N+1.
    /// @param encryptedArgs  ABI-encoded encrypted payload (decrypted by threshold nodes)
    /// @param plainArgs      ABI-encoded plaintext payload forwarded as-is to onDecrypt
    /// @param gasLimit        Gas limit for the CTX callback execution
    function decryptAndExecute(
        bytes calldata encryptedArgs,
        bytes calldata plainArgs,
        uint256 gasLimit
    ) external;

    /// @notice Returns the one-time wallet address that will send the next CTX.
    /// @dev    Caller MUST fund this wallet with enough ETH for the CTX gas cost
    ///         BEFORE calling `decryptAndExecute`.
    /// @return wallet  The address of the one-time CTX wallet
    function getRandomWalletForCTX() external returns (address wallet);
}

// ============================================================================
//  Callback Interface — implemented by contracts receiving CTX results
// ============================================================================

/// @title IBITECallback — Callback for BITE V2 decrypted transaction execution
interface IBITECallback {
    /// @notice Called by the one-time wallet W when the CTX executes in block N+1.
    /// @param decryptedArgs  The decrypted payload (was encrypted when submitted)
    /// @param plainArgs      The plaintext payload (passed through unchanged)
    function onDecrypt(bytes calldata decryptedArgs, bytes calldata plainArgs) external;
}

// ============================================================================
//  TwinkleEscrowV3
// ============================================================================

/// @title TwinkleEscrowV3 — Conditional escrow with BITE V2 auto-settlement
/// @notice Extends the standard buyer-deposits / quality-threshold-settles escrow
///         pattern with confidential auto-settlement via BITE V2 CTX callbacks.
///
///         Flow A — Manual settlement:
///           1. Buyer calls `createEscrow(provider, amount, metadataHash)`
///           2. Buyer (or anyone with authority) calls `verifyAndSettle(escrowId, qualityScore)`
///           3. Score >= 5 → provider paid; score < 5 → buyer refunded
///
///         Flow B — BITE V2 auto-settlement:
///           1. Buyer calls `createEncryptedEscrow(provider, amount, encryptedConditions)`
///           2. Buyer calls `prepareAutoSettle(escrowId)` to get & fund one-time wallet W
///           3. Buyer calls `initiateAutoSettle(escrowId)` to schedule the CTX
///           4. In block N+1, wallet W calls `onDecrypt(...)` which auto-settles
///
/// @dev    Quality threshold: score >= 5 → PAID (provider), score < 5 → REFUNDED (buyer).
///         Default timeout is 1 hour. Owner can configure allowedTokens, maxEscrowAmount,
///         and timeout. Emergency refund available after 2x timeout.
contract TwinkleEscrowV3 is Ownable, ReentrancyGuard, IBITECallback {
    using SafeERC20 for IERC20;

    // ── Constants ───────────────────────────────────────────────────────────

    /// @notice BITE V2 precompile address on SKALE
    IBITEV2 public constant BITE_V2 = IBITEV2(0x0000000000000000000000000000000000000100);

    /// @notice Quality score threshold: >= this value means provider gets paid
    uint8 public constant QUALITY_THRESHOLD = 5;

    /// @notice Default escrow timeout (1 hour)
    uint256 public constant DEFAULT_TIMEOUT = 1 hours;

    /// @notice Emergency refund multiplier — owner can trigger after timeout * this
    uint256 public constant EMERGENCY_TIMEOUT_MULTIPLIER = 2;

    // ── Enums ───────────────────────────────────────────────────────────────

    enum Status {
        Pending,   // 0 — funds deposited, awaiting settlement
        Settled,   // 1 — provider paid (quality met threshold)
        Refunded   // 2 — buyer refunded (quality below threshold or timeout)
    }

    // ── Structs ─────────────────────────────────────────────────────────────

    struct Escrow {
        address buyer;           // depositor / payer
        address provider;        // service provider / payee
        address token;           // ERC-20 token (must be in allowedTokens)
        uint256 amount;          // escrowed amount
        bytes32 metadataHash;    // hash of off-chain metadata (service description, etc.)
        Status  status;          // current escrow state
        uint256 createdAt;       // block.timestamp when created
        // BITE V2 auto-settle fields
        bytes   encryptedConditions; // encrypted settlement conditions (empty for manual)
        address ctxWallet;           // one-time wallet W for CTX callback verification
        bool    autoSettleInitiated; // whether decryptAndExecute has been called
    }

    // ── State ───────────────────────────────────────────────────────────────

    /// @notice Token allowlist — only whitelisted tokens can be escrowed
    mapping(address => bool) public allowedTokens;

    /// @notice Maximum amount that can be escrowed in a single escrow
    uint256 public maxEscrowAmount;

    /// @notice Configurable timeout for escrows (default 1 hour)
    uint256 public escrowTimeout;

    /// @notice All escrows by ID
    mapping(uint256 => Escrow) public escrows;

    /// @notice Auto-incrementing escrow counter
    uint256 public escrowCount;

    // ── Events ──────────────────────────────────────────────────────────────

    /// @notice Emitted when a new escrow is created (manual or encrypted)
    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed provider,
        uint256 amount,
        bytes32 metadataHash
    );

    /// @notice Emitted when an escrow is settled (provider paid)
    event EscrowSettled(uint256 indexed escrowId, uint8 qualityScore);

    /// @notice Emitted when an escrow is refunded (buyer refunded)
    event EscrowRefunded(uint256 indexed escrowId);

    /// @notice Emitted when auto-settlement is initiated via BITE V2
    event AutoSettleInitiated(uint256 indexed escrowId, address ctxWallet);

    /// @notice Emitted when auto-settlement executes via onDecrypt callback
    /// @param action "PAID" if provider paid, "REFUNDED" if buyer refunded
    event AutoSettleExecuted(
        uint256 indexed escrowId,
        uint8 qualityScore,
        string action
    );

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
    error AutoSettleNotPrepared(uint256 escrowId);
    error NoEncryptedConditions(uint256 escrowId);
    error UnauthorizedCTXWallet(address caller, address expected);

    // ── Constructor ─────────────────────────────────────────────────────────

    /// @param _maxEscrowAmount  Initial maximum escrow amount
    constructor(uint256 _maxEscrowAmount) Ownable(msg.sender) {
        maxEscrowAmount = _maxEscrowAmount;
        escrowTimeout = DEFAULT_TIMEOUT;
    }

    // ── Owner Configuration ─────────────────────────────────────────────────

    /// @notice Set the maximum amount allowed per escrow
    function setMaxEscrowAmount(uint256 _amount) external onlyOwner {
        maxEscrowAmount = _amount;
    }

    /// @notice Whitelist or de-list a token for escrow deposits
    function setAllowedToken(address _token, bool _allowed) external onlyOwner {
        if (_token == address(0)) revert ZeroAddress();
        allowedTokens[_token] = _allowed;
    }

    /// @notice Update the escrow timeout duration
    /// @param _timeout  New timeout in seconds (must be > 0)
    function setEscrowTimeout(uint256 _timeout) external onlyOwner {
        require(_timeout > 0, "Timeout must be > 0");
        escrowTimeout = _timeout;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  FLOW A — Manual Escrow
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Create a standard escrow. Buyer deposits `amount` of an allowed token.
    /// @param provider      Address of the service provider (payee)
    /// @param token         ERC-20 token address (must be in allowedTokens)
    /// @param amount        Amount to escrow
    /// @param metadataHash  Keccak256 hash of off-chain metadata describing the service
    /// @return escrowId     The ID of the newly created escrow
    function createEscrow(
        address provider,
        address token,
        uint256 amount,
        bytes32 metadataHash
    ) external nonReentrant returns (uint256 escrowId) {
        _validateEscrowParams(provider, token, amount);

        // Transfer tokens from buyer to this contract
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
            encryptedConditions: "",
            ctxWallet: address(0),
            autoSettleInitiated: false
        });

        emit EscrowCreated(escrowId, msg.sender, provider, amount, metadataHash);
    }

    /// @notice Manual settlement — buyer provides a quality score.
    ///         Score >= 5 → provider paid. Score < 5 → buyer refunded.
    /// @param escrowId     The escrow to settle
    /// @param qualityScore Quality score (0–10)
    function verifyAndSettle(
        uint256 escrowId,
        uint8 qualityScore
    ) external nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);

        _settleByScore(escrowId, e, qualityScore);
    }

    /// @notice Buyer claims a refund after the escrow timeout has elapsed.
    /// @param escrowId  The escrow to refund
    function claimRefund(uint256 escrowId) external nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);

        uint256 deadline = e.createdAt + escrowTimeout;
        if (block.timestamp <= deadline) revert EscrowNotExpired(escrowId, deadline);

        e.status = Status.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);

        emit EscrowRefunded(escrowId);
    }

    /// @notice Owner-only emergency refund after extended timeout (2x normal timeout).
    ///         Prevents funds from being permanently locked if buyer disappears.
    /// @param escrowId  The escrow to emergency-refund
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
    //  FLOW B — BITE V2 Auto-Settlement
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Create an escrow with encrypted settlement conditions for BITE V2 auto-settle.
    /// @param provider             Address of the service provider
    /// @param token                ERC-20 token address
    /// @param amount               Amount to escrow
    /// @param encryptedConditions  Encrypted settlement conditions (decrypted by BITE V2 threshold nodes)
    /// @return escrowId            The ID of the newly created escrow
    function createEncryptedEscrow(
        address provider,
        address token,
        uint256 amount,
        bytes calldata encryptedConditions
    ) external nonReentrant returns (uint256 escrowId) {
        _validateEscrowParams(provider, token, amount);
        require(encryptedConditions.length > 0, "Empty encrypted conditions");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        escrowId = escrowCount++;
        escrows[escrowId] = Escrow({
            buyer: msg.sender,
            provider: provider,
            token: token,
            amount: amount,
            metadataHash: keccak256(encryptedConditions),
            status: Status.Pending,
            createdAt: block.timestamp,
            encryptedConditions: encryptedConditions,
            ctxWallet: address(0),
            autoSettleInitiated: false
        });

        emit EscrowCreated(
            escrowId,
            msg.sender,
            provider,
            amount,
            keccak256(encryptedConditions)
        );
    }

    /// @notice Step 1 of auto-settle: Get the one-time CTX wallet from BITE V2 and store it.
    ///         The buyer MUST fund wallet W with enough ETH to cover CTX gas costs
    ///         BEFORE calling `initiateAutoSettle`.
    /// @param escrowId  The encrypted escrow to prepare for auto-settlement
    /// @return wallet   The one-time CTX wallet address that needs to be funded
    function prepareAutoSettle(
        uint256 escrowId
    ) external nonReentrant returns (address wallet) {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);
        if (e.encryptedConditions.length == 0) revert NoEncryptedConditions(escrowId);
        if (e.autoSettleInitiated) revert AutoSettleAlreadyInitiated(escrowId);

        // Get the one-time wallet address from BITE V2 precompile
        wallet = BITE_V2.getRandomWalletForCTX();

        // Store the wallet address for verification in onDecrypt
        e.ctxWallet = wallet;
    }

    /// @notice Step 2 of auto-settle: Schedule the CTX via BITE V2 `decryptAndExecute`.
    ///         The one-time wallet W must be funded before calling this.
    ///         The CTX will execute in block N+1 and call `onDecrypt` on this contract.
    /// @param escrowId  The encrypted escrow to initiate auto-settlement for
    /// @param gasLimit  Gas limit for the CTX callback execution
    function initiateAutoSettle(
        uint256 escrowId,
        uint256 gasLimit
    ) external nonReentrant {
        Escrow storage e = _getValidEscrow(escrowId);
        if (msg.sender != e.buyer) revert NotBuyer(msg.sender, e.buyer);
        if (e.ctxWallet == address(0)) revert AutoSettleNotPrepared(escrowId);
        if (e.autoSettleInitiated) revert AutoSettleAlreadyInitiated(escrowId);

        e.autoSettleInitiated = true;

        // plainArgs carries the escrow ID so onDecrypt knows which escrow to settle
        bytes memory plainArgs = abi.encode(escrowId);

        // Schedule the CTX — BITE V2 threshold nodes will decrypt encryptedConditions
        // and call onDecrypt on this contract in block N+1 via wallet W
        BITE_V2.decryptAndExecute(
            e.encryptedConditions,
            plainArgs,
            gasLimit
        );

        emit AutoSettleInitiated(escrowId, e.ctxWallet);
    }

    /// @notice BITE V2 CTX callback — executed by the one-time wallet W in block N+1.
    ///         Decodes the decrypted quality score and settles the escrow accordingly.
    /// @dev    IMPORTANT: msg.sender is wallet W (NOT the precompile address).
    ///         CTXs execute BEFORE regular transactions in block N+1.
    /// @param decryptedArgs  ABI-encoded (uint256 escrowId, uint8 qualityScore)
    /// @param plainArgs      ABI-encoded (uint256 escrowId) — used for cross-validation
    function onDecrypt(
        bytes calldata decryptedArgs,
        bytes calldata plainArgs
    ) external override nonReentrant {
        // Decode the plaintext escrow ID (for cross-referencing)
        uint256 plainEscrowId = abi.decode(plainArgs, (uint256));

        // Decode the decrypted settlement data
        (uint256 decryptedEscrowId, uint8 qualityScore) = abi.decode(
            decryptedArgs,
            (uint256, uint8)
        );

        // Cross-validate: the escrow ID in plainArgs must match decryptedArgs
        require(
            plainEscrowId == decryptedEscrowId,
            "Escrow ID mismatch between plain and decrypted args"
        );

        uint256 escrowId = decryptedEscrowId;
        Escrow storage e = _getValidEscrow(escrowId);

        // Security: verify msg.sender is the stored one-time CTX wallet
        if (msg.sender != e.ctxWallet) {
            revert UnauthorizedCTXWallet(msg.sender, e.ctxWallet);
        }

        // Verify auto-settle was actually initiated
        require(e.autoSettleInitiated, "Auto-settle not initiated");

        // Settle based on quality score
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

    /// @notice Get full escrow details by ID
    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        return escrows[escrowId];
    }

    /// @notice Check if an escrow is expired (past timeout)
    function isExpired(uint256 escrowId) external view returns (bool) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        return block.timestamp > escrows[escrowId].createdAt + escrowTimeout;
    }

    /// @notice Get the deadline timestamp for an escrow
    function getDeadline(uint256 escrowId) external view returns (uint256) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        return escrows[escrowId].createdAt + escrowTimeout;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Internal Helpers
    // ════════════════════════════════════════════════════════════════════════

    /// @dev Validate common escrow creation parameters
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

    /// @dev Retrieve an escrow and verify it exists and is still Pending
    function _getValidEscrow(uint256 escrowId) internal view returns (Escrow storage e) {
        if (escrowId >= escrowCount) revert InvalidEscrowId(escrowId);
        e = escrows[escrowId];
        if (e.status != Status.Pending) revert EscrowNotPending(escrowId, e.status);
    }

    /// @dev Settle an escrow based on quality score.
    ///      Score >= QUALITY_THRESHOLD → provider paid. Below → buyer refunded.
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
