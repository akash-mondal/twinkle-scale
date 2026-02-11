// Core types for the Twinkle SDK

export interface TwinkleClientConfig {
  rpcUrl: string;
  privateKey: string;
  /** Override contract addresses (for testing or custom deployments) */
  contracts?: Partial<ContractAddresses>;
}

export interface ContractAddresses {
  escrowV2: string;
  identityRegistry: string;
  reputationRegistry: string;
  usdc: string;
}

// --- BITE ---

export interface BiteEncryptResult {
  txHash: string;
  encrypted: boolean;
  sendTime: number;
  receiptTime: number;
  gasUsed?: bigint;
}

export interface BiteDecryptResult {
  to: string;
  data: string;
  decryptTime: number;
}

export interface BiteCommitResult {
  txHash: string;
  encrypted: boolean;
  sendTime: number;
  receiptTime: number;
  gasUsed?: bigint;
  /** The original hex data that was encrypted */
  originalHex: string;
}

// --- Escrow ---

export enum EscrowStatus {
  Created = 0,
  ResponseSubmitted = 1,
  Settled = 2,
  Refunded = 3,
}

export interface EscrowData {
  id: number;
  buyer: string;
  seller: string;
  token: string;
  amount: bigint;
  requestTxHash: string;
  responseTxHash: string;
  deadline: bigint;
  status: EscrowStatus;
}

export interface CreateEscrowParams {
  seller: string;
  token: string;
  amount: bigint;
  deadline: number;
  requestHash: string;
  /** If true, wrap in BITE encryption */
  encrypted?: boolean;
}

export interface SettleResult {
  txHash: string;
  matched: boolean;
  escrowId: number;
}

// --- Identity ---

export interface AgentIdentity {
  agentId: number;
  owner: string;
  uri: string;
  metadata: Record<string, string>;
}

export interface RegisterAgentParams {
  uri?: string;
  metadata?: Record<string, string>;
}

// --- Reputation ---

export interface FeedbackParams {
  agentId: number;
  value: number;
  decimals?: number;
  tag1: string;
  tag2?: string;
  endpoint?: string;
}

export interface ReputationSummary {
  count: number;
  averageValue: number;
  decimals: number;
}
