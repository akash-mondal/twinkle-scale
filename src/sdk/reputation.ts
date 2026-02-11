// Reputation module — on-chain trust scores via ERC-8004

import { ethers } from 'ethers';
import { CONTRACTS, REPUTATION_REGISTRY_ABI } from './config.js';
import type { FeedbackParams, ReputationSummary } from './types.js';

export class ReputationModule {
  private contract: ethers.Contract;

  constructor(
    private provider: ethers.JsonRpcProvider,
    private signer: ethers.Wallet,
    contractAddress?: string,
  ) {
    const addr = contractAddress || CONTRACTS.reputationRegistry;
    this.contract = new ethers.Contract(addr, REPUTATION_REGISTRY_ABI, this.signer);
  }

  async submit(params: FeedbackParams): Promise<string> {
    const { agentId, value, decimals = 0, tag1, tag2 = '', endpoint = '' } = params;
    const tx = await this.contract.giveFeedback(
      agentId, value, decimals, tag1, tag2, endpoint,
      { type: 0, gasLimit: 300000 },
    );
    const receipt = await tx.wait();
    return receipt!.hash;
  }

  async query(agentId: number, tag1 = ''): Promise<ReputationSummary> {
    const [count, summaryValue, summaryDecimals] = await this.contract.getSummary(
      agentId, [], tag1,
    );
    return {
      count: Number(count),
      averageValue: Number(summaryValue),
      decimals: Number(summaryDecimals),
    };
  }

  async getClients(agentId: number): Promise<string[]> {
    return [...await this.contract.getClients(agentId)];
  }

  async readFeedback(agentId: number, clientAddress: string, index: number): Promise<{
    value: number;
    decimals: number;
    tag1: string;
    tag2: string;
    revoked: boolean;
  }> {
    const [value, decimals, tag1, tag2, isRevoked] = await this.contract.readFeedback(
      agentId, clientAddress, index,
    );
    return {
      value: Number(value),
      decimals: Number(decimals),
      tag1,
      tag2,
      revoked: isRevoked,
    };
  }
}
