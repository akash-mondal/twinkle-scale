// Agent types — BITE layers, events, receipts, AP2 mandates
import type { MandateChain } from './ap2-mandates.js';

export type BiteLayer = 'strategy' | 'escrow' | 'query' | 'settlement' | 'none';

export interface BiteLayerResult {
  layer: BiteLayer;
  txHash: string;
  encrypted: boolean;
  timing: { sendMs: number; receiptMs: number; decryptMs?: number };
  dataPreview: string;
  verified?: boolean;
}

export type AgentEventType =
  | 'agent:start' | 'encryption:decision'
  | 'bite:encrypting' | 'bite:committed' | 'bite:decrypted' | 'bite:verified'
  | 'provider:discovered' | 'provider:selected'
  | 'x402:challenge' | 'x402:payment' | 'x402:success'
  | 'escrow:created' | 'escrow:response' | 'escrow:settled'
  | 'quality:evaluated' | 'reputation:updated'
  | 'synthesis:complete' | 'agent:receipt' | 'agent:error'
  | 'ap2:intent' | 'ap2:cart' | 'ap2:payment' | 'ap2:settled' | 'ap2:complete';

export interface AgentEvent {
  type: AgentEventType;
  timestamp: number;
  phase: string;
  data: Record<string, any>;
  biteLayer?: BiteLayerResult;
}

export type AgentEventHandler = (event: AgentEvent) => void;

export interface EncryptionDecision {
  layers: BiteLayer[];
  reasoning: string;
  threatModel: string[];
  sensitivityLevel: 'high' | 'medium' | 'low';
}

export interface ProviderConfig {
  name: string;
  port: number;
  price: string;
  dataSources: string[];
  quality: 'high' | 'medium' | 'low';
  privateKey: string;
  address: string;
  handler?: (query: string) => Promise<any>;
}

export interface ProviderResult {
  name: string;
  agentId: number;
  address: string;
  x402: {
    amount: string;
    paid: boolean;
    endpoint: string;
    x402Used: boolean;
    x402Cost: string;
  };
  escrow: {
    id: number;
    amount: string;
    biteEncrypted: boolean;
    txHash: string;
    timing: { sendMs: number; receiptMs: number };
  };
  delivery: {
    hash: string;
    qualityScore: number;
    passed: boolean;
    reasoning: string;
    analysis?: any;
  };
  settlement: { action: 'paid' | 'refunded'; txHash: string };
  reputation: { score: number; tags: string[] };
}

export interface AgentReceipt {
  id: string;
  query: string;
  timestamp: number;
  duration: number;
  encryptionDecision: EncryptionDecision;
  biteCommitments: {
    strategy?: { txHash: string; originalHex: string; verified: boolean; timing: number };
    query?: { txHash: string; originalHex: string; verified: boolean; timing: number };
    settlements?: { txHash: string; originalHex: string; verified: boolean; timing: number };
  };
  providers: ProviderResult[];
  synthesis: string;
  mandateChain?: MandateChain;
  totals: {
    paid: string;
    refunded: string;
    biteEncryptions: number;
    biteMessages: number;
    x402Payments: number;
    escrowsCreated: number;
  };
}

export interface AgentRunConfig {
  query: string;
  budget: string;
  rpcUrl: string;
  buyerPk: string;
  providerConfigs: ProviderConfig[];
  openaiApiKey: string;
  token: string;
  qualityThreshold?: number;
  useX402?: boolean;
  category?: AgentCategory;
  onEvent?: AgentEventHandler;
}

// --- Twinkle Marketplace Types ---

export type AgentCategory = 'code-audit' | 'legal-review' | 'ip-patent' | 'defi-strategy';

export interface TwinkleProviderConfig extends ProviderConfig {
  category: AgentCategory;
  handler: (query: string) => Promise<any>;
  description?: string;
}

export interface ActConfig {
  category: AgentCategory;
  query: string;
  budget: string;
  providers: TwinkleProviderConfig[];
}

export interface ActResult {
  category: AgentCategory;
  receipt: AgentReceipt;
  duration: number;
}

export interface MarketplaceConfig {
  acts: ActConfig[];
  rpcUrl: string;
  buyerPk: string;
  openaiApiKey: string;
  token: string;
  qualityThreshold?: number;
  useX402?: boolean;
  onEvent?: AgentEventHandler;
}

export interface MarketplaceReceipt {
  id: string;
  timestamp: number;
  duration: number;
  acts: ActResult[];
  totals: {
    escrowsCreated: number;
    paid: string;
    refunded: string;
    biteEncryptions: number;
    x402Payments: number;
    agentsHired: number;
    agentsPaid: number;
    agentsRefunded: number;
    llmTokensUsed?: number;
    llmCost?: string;
  };
  mandateChains: MandateChain[];
  synthesis: string;
}
