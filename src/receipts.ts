// Receipt builder — structured audit trail with BITE proofs.

import { TwinkleClient } from './sdk/index.js';
import type { AgentReceipt, EncryptionDecision, ProviderResult, BiteLayerResult } from './types.js';
import type { MandateChain } from './ap2-mandates.js';

let receiptCounter = 0;

export function buildReceipt(data: {
  query: string;
  startTime: number;
  encryptionDecision: EncryptionDecision;
  strategyCommit?: BiteLayerResult;
  queryCommit?: BiteLayerResult;
  settlementsCommit?: BiteLayerResult;
  providers: ProviderResult[];
  synthesis: string;
  mandateChain?: MandateChain;
}): AgentReceipt {
  receiptCounter++;

  const totalPaid = data.providers
    .filter(p => p.settlement.action === 'paid')
    .reduce((sum, p) => sum + parseFloat(p.escrow.amount), 0);

  const totalRefunded = data.providers
    .filter(p => p.settlement.action === 'refunded')
    .reduce((sum, p) => sum + parseFloat(p.escrow.amount), 0);

  let biteEncryptions = data.providers.filter(p => p.escrow.biteEncrypted).length;
  let biteMessages = 0;

  const biteCommitments: AgentReceipt['biteCommitments'] = {};

  if (data.strategyCommit) {
    biteCommitments.strategy = {
      txHash: data.strategyCommit.txHash,
      originalHex: data.strategyCommit.dataPreview,
      verified: data.strategyCommit.verified ?? false,
      timing: (data.strategyCommit.timing.decryptMs || 0) - data.strategyCommit.timing.sendMs,
    };
    biteMessages++;
  }

  if (data.queryCommit) {
    biteCommitments.query = {
      txHash: data.queryCommit.txHash,
      originalHex: data.queryCommit.dataPreview,
      verified: data.queryCommit.verified ?? false,
      timing: (data.queryCommit.timing.decryptMs || 0) - data.queryCommit.timing.sendMs,
    };
    biteMessages++;
  }

  if (data.settlementsCommit) {
    biteCommitments.settlements = {
      txHash: data.settlementsCommit.txHash,
      originalHex: data.settlementsCommit.dataPreview,
      verified: data.settlementsCommit.verified ?? false,
      timing: (data.settlementsCommit.timing.decryptMs || 0) - data.settlementsCommit.timing.sendMs,
    };
    biteMessages++;
  }

  biteEncryptions += biteMessages;

  return {
    id: `twinkle-receipt-${receiptCounter}-${Date.now()}`,
    query: data.query,
    timestamp: data.startTime,
    duration: Date.now() - data.startTime,
    encryptionDecision: data.encryptionDecision,
    biteCommitments,
    providers: data.providers,
    synthesis: data.synthesis,
    mandateChain: data.mandateChain,
    totals: {
      paid: totalPaid.toFixed(2),
      refunded: totalRefunded.toFixed(2),
      biteEncryptions,
      biteMessages,
      x402Payments: data.providers.filter(p => p.x402.paid).length,
      escrowsCreated: data.providers.length,
    },
  };
}
