// BITE Layers Orchestrator — The hero feature.
// 5 layers of threshold encryption across the entire commerce lifecycle.
//
// Layer 1: Strategy Commitment — encrypt plan BEFORE executing (encryptMessage)
// Layer 2: Encrypted Escrows — escrow creation via BITE (encryptTransaction)
// Layer 3: Encrypted Queries — encrypt the query itself (encryptMessage)
// Layer 4: Encrypted Settlement Batch — all decisions revealed simultaneously (encryptMessage)
// Layer 5: Encryption Decision Reasoning — LLM decides which layers to activate

import { TwinkleClient } from './sdk/index.js';
import type { CreateEscrowParams } from './sdk/index.js';
import { AgentEventEmitter } from './events.js';
import type { BiteLayer, BiteLayerResult } from './types.js';

export class BiteLayers {
  private encryptions = 0;
  private messages = 0;
  private activeLayers: BiteLayer[] = [];

  constructor(
    private client: TwinkleClient,
    private events: AgentEventEmitter,
  ) {}

  async commitStrategy(strategy: object): Promise<BiteLayerResult> {
    const hex = Buffer.from(JSON.stringify(strategy)).toString('hex');

    this.events.emit('bite:encrypting', 'strategy-commitment', {
      layer: 'strategy',
      dataSize: hex.length,
      preview: JSON.stringify(strategy).slice(0, 100),
    });

    const result = await this.client.bite.commitEncrypted(hex);
    this.encryptions++;
    this.messages++;

    this.events.emit('bite:committed', 'strategy-commitment', {
      txHash: result.txHash,
      timing: result.receiptTime - result.sendTime,
      layer: 'strategy',
    });

    const decrypted = await this.waitAndVerify(result.txHash, hex);

    this.events.emit('bite:verified', 'strategy-commitment', {
      txHash: result.txHash,
      verified: decrypted.verified,
      layer: 'strategy',
    });

    this.activeLayers.push('strategy');

    return {
      layer: 'strategy',
      txHash: result.txHash,
      encrypted: true,
      timing: {
        sendMs: result.sendTime,
        receiptMs: result.receiptTime,
        decryptMs: decrypted.decryptTime,
      },
      dataPreview: hex.slice(0, 40),
      verified: decrypted.verified,
    };
  }

  async createEncryptedEscrow(params: CreateEscrowParams): Promise<{
    escrowId: number;
    biteResult: BiteLayerResult;
  }> {
    this.events.emit('bite:encrypting', 'encrypted-escrow', {
      layer: 'escrow',
      seller: params.seller,
      amount: params.amount.toString(),
    });

    const result = await this.client.escrow.create({
      ...params,
      encrypted: true,
    });

    this.encryptions++;
    this.activeLayers.push('escrow');

    const biteResult: BiteLayerResult = {
      layer: 'escrow',
      txHash: result.txHash,
      encrypted: true,
      timing: {
        sendMs: result.biteResult?.sendTime || 0,
        receiptMs: result.biteResult?.receiptTime || 0,
      },
      dataPreview: `escrow:${result.escrowId}`,
    };

    this.events.emit('bite:committed', 'encrypted-escrow', {
      txHash: result.txHash,
      escrowId: result.escrowId,
      timing: (result.biteResult?.receiptTime || 0) - (result.biteResult?.sendTime || 0),
      layer: 'escrow',
    });

    return { escrowId: result.escrowId, biteResult };
  }

  async commitQuery(query: string): Promise<BiteLayerResult> {
    const hex = Buffer.from(query).toString('hex');

    this.events.emit('bite:encrypting', 'encrypted-query', {
      layer: 'query',
      dataSize: hex.length,
      preview: query.slice(0, 80),
    });

    const result = await this.client.bite.commitEncrypted(hex);
    this.encryptions++;
    this.messages++;

    this.events.emit('bite:committed', 'encrypted-query', {
      txHash: result.txHash,
      timing: result.receiptTime - result.sendTime,
      layer: 'query',
    });

    const decrypted = await this.waitAndVerify(result.txHash, hex);

    this.events.emit('bite:verified', 'encrypted-query', {
      txHash: result.txHash,
      verified: decrypted.verified,
      layer: 'query',
    });

    this.activeLayers.push('query');

    return {
      layer: 'query',
      txHash: result.txHash,
      encrypted: true,
      timing: {
        sendMs: result.sendTime,
        receiptMs: result.receiptTime,
        decryptMs: decrypted.decryptTime,
      },
      dataPreview: hex.slice(0, 40),
      verified: decrypted.verified,
    };
  }

  async commitSettlements(
    decisions: Array<{ escrowId: number; action: 'pay' | 'refund'; score: number }>,
  ): Promise<BiteLayerResult> {
    const hex = Buffer.from(JSON.stringify(decisions)).toString('hex');

    this.events.emit('bite:encrypting', 'settlement-batch', {
      layer: 'settlement',
      count: decisions.length,
      preview: decisions.map(d => `#${d.escrowId}:${d.action}`).join(', '),
    });

    const result = await this.client.bite.commitEncrypted(hex);
    this.encryptions++;
    this.messages++;

    this.events.emit('bite:committed', 'settlement-batch', {
      txHash: result.txHash,
      timing: result.receiptTime - result.sendTime,
      layer: 'settlement',
    });

    const decrypted = await this.waitAndVerify(result.txHash, hex);

    this.events.emit('bite:verified', 'settlement-batch', {
      txHash: result.txHash,
      verified: decrypted.verified,
      layer: 'settlement',
    });

    this.activeLayers.push('settlement');

    return {
      layer: 'settlement',
      txHash: result.txHash,
      encrypted: true,
      timing: {
        sendMs: result.sendTime,
        receiptMs: result.receiptTime,
        decryptMs: decrypted.decryptTime,
      },
      dataPreview: hex.slice(0, 40),
      verified: decrypted.verified,
    };
  }

  private async waitAndVerify(
    txHash: string,
    expectedHex: string,
  ): Promise<{ verified: boolean; decryptedData: string; decryptTime: number }> {
    const start = Date.now();
    let decryptedData = '';

    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        decryptedData = await this.client.bite.decryptCommitment(txHash);
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    const decryptTime = Date.now();

    const normalizedDecrypted = decryptedData.replace(/^0x/i, '').toLowerCase();
    const normalizedExpected = expectedHex.replace(/^0x/i, '').toLowerCase();
    const verified = normalizedDecrypted === normalizedExpected ||
      normalizedDecrypted.includes(normalizedExpected);

    return { verified, decryptedData, decryptTime };
  }

  getStats(): { encryptions: number; messages: number; layers: BiteLayer[] } {
    return {
      encryptions: this.encryptions,
      messages: this.messages,
      layers: [...new Set(this.activeLayers)],
    };
  }
}
