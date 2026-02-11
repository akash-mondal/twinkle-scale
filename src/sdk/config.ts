// Chain configuration and contract ABIs for Twinkle
// Default: BITE V2 Sandbox 2 (overridable via TwinkleClientConfig.contracts)

export const BITE_V2_SANDBOX = {
  chainId: 103698795,
  name: 'BITE V2 Sandbox 2',
  rpcUrl: 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2',
} as const;

// Deployed contract addresses on BITE V2 Sandbox 2
export const CONTRACTS = {
  escrowV2: '0xf3B70753B094c5D32E70659D67A7A77Da9BCC902',
  identityRegistry: '0xadFA846809BB16509fE7329A9C36b2d5E018fFb3',
  reputationRegistry: '0x00608B8A89Ed40dD6B9238680Cc4E037C3E04C0e',
  usdc: '0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8',
} as const;

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
] as const;

export const ESCROW_V2_ABI = [
  'function createEscrow(bytes32 requestTxHash, address seller, address token, uint256 amount, uint256 deadline) returns (uint256)',
  'function submitResponse(uint256 escrowId, bytes32 responseTxHash)',
  'function settle(uint256 escrowId, bool matched)',
  'function verifyAndSettle(uint256 escrowId, bytes32 deliveryProof)',
  'function claimRefund(uint256 escrowId)',
  'function emergencyRefund(uint256 escrowId)',
  'function escrowCount() view returns (uint256)',
  'function escrows(uint256) view returns (address buyer, address seller, address token, uint256 amount, bytes32 requestTxHash, bytes32 responseTxHash, uint256 deadline, uint8 status)',
  'function maxEscrowAmount() view returns (uint256)',
  'function allowedTokens(address) view returns (bool)',
  'function GRACE_PERIOD() view returns (uint256)',
  'function setMaxEscrowAmount(uint256 amount)',
  'function setAllowedToken(address token, bool allowed)',
  'function owner() view returns (address)',
  'event EscrowCreated(uint256 indexed id, address buyer, address seller, uint256 deadline)',
  'event ResponseSubmitted(uint256 indexed id, address seller)',
  'event EscrowSettled(uint256 indexed id, bool matched)',
  'event EscrowRefunded(uint256 indexed id)',
  'event ConditionVerified(uint256 indexed id, bytes32 deliveryProof)',
] as const;

export const IDENTITY_REGISTRY_ABI = [
  'function register() returns (uint256)',
  'function registerWithURI(string agentURI) returns (uint256)',
  'function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)',
  'function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function agentURI(uint256 agentId) view returns (string)',
  'function isAuthorizedOrOwner(address spender, uint256 agentId) view returns (bool)',
  'function agentCount() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
  'event MetadataSet(uint256 indexed agentId, string metadataKey, bytes metadataValue)',
] as const;

export const REPUTATION_REGISTRY_ABI = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint)',
  'function revokeFeedback(uint256 agentId, uint64 feedbackIndex)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function getClients(uint256 agentId) view returns (address[])',
  'function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)',
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint)',
] as const;
