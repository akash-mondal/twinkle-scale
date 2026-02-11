// Identity module — ERC-8004 agent registration and discovery

import { ethers } from 'ethers';
import { CONTRACTS, IDENTITY_REGISTRY_ABI } from './config.js';
import type { AgentIdentity, RegisterAgentParams } from './types.js';

export class IdentityModule {
  private contract: ethers.Contract;

  constructor(
    private provider: ethers.JsonRpcProvider,
    private signer: ethers.Wallet,
    contractAddress?: string,
  ) {
    const addr = contractAddress || CONTRACTS.identityRegistry;
    this.contract = new ethers.Contract(addr, IDENTITY_REGISTRY_ABI, this.signer);
  }

  async register(params?: RegisterAgentParams): Promise<number> {
    let tx;
    if (params?.uri) {
      tx = await this.contract.registerWithURI(params.uri, { type: 0, gasLimit: 300000 });
    } else {
      tx = await this.contract.register({ type: 0, gasLimit: 300000 });
    }
    const receipt = await tx.wait();

    const iface = new ethers.Interface(IDENTITY_REGISTRY_ABI);
    for (const log of receipt!.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'Registered') {
          const agentId = Number(parsed.args[0]);

          if (params?.metadata) {
            for (const [key, value] of Object.entries(params.metadata)) {
              await this.setMetadata(agentId, key, value);
            }
          }
          return agentId;
        }
      } catch { /* skip */ }
    }
    throw new Error('Could not parse Registered event');
  }

  async setMetadata(agentId: number, key: string, value: string): Promise<void> {
    const encoded = ethers.toUtf8Bytes(value);
    const tx = await this.contract.setMetadata(agentId, key, encoded, { type: 0, gasLimit: 200000 });
    await tx.wait();
  }

  async getMetadata(agentId: number, key: string): Promise<string> {
    const raw = await this.contract.getMetadata(agentId, key);
    if (!raw || raw === '0x') return '';
    return ethers.toUtf8String(raw);
  }

  async resolve(agentId: number): Promise<AgentIdentity> {
    const owner = await this.contract.ownerOf(agentId);
    const uri = await this.contract.agentURI(agentId);
    return {
      agentId,
      owner,
      uri,
      metadata: {},
    };
  }

  async getAgentWallet(agentId: number): Promise<string> {
    return await this.contract.getAgentWallet(agentId);
  }

  async getAgentCount(): Promise<number> {
    const count = await this.contract.agentCount();
    return Number(count);
  }

  async search(metadataKey: string, metadataValue: string, limit = 20): Promise<AgentIdentity[]> {
    const total = await this.getAgentCount();
    const results: AgentIdentity[] = [];

    const start = Math.max(0, total - limit);
    for (let i = total - 1; i >= start && results.length < limit; i--) {
      try {
        const val = await this.getMetadata(i, metadataKey);
        if (val.includes(metadataValue)) {
          const identity = await this.resolve(i);
          identity.metadata[metadataKey] = val;
          results.push(identity);
        }
      } catch { /* agent may not exist */ }
    }
    return results;
  }
}
