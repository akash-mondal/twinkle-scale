// Agent Registry — All 10 Twinkle agents with configs, handlers, ports
import type { TwinkleProviderConfig, AgentCategory } from '../types.js';
import { sentinel, quickScan, auditBot } from './code-audit.js';
import { lexGuard, contractEye } from './legal-review.js';
import { patentHawk, priorArt, patentLite } from './ip-patent.js';
import { yieldSage, alphaQuick } from './defi-strategy.js';

export interface AgentRegistryEntry {
  name: string;
  category: AgentCategory;
  port: number;
  price: string;
  quality: 'high' | 'medium' | 'low';
  handler: (query: string) => Promise<any>;
  description: string;
  dataSources: string[];
}

// All 10 agents
export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  // Code Audit (3)
  { name: 'Sentinel', category: 'code-audit', port: 5001, price: '0.08', quality: 'high', handler: sentinel, description: 'Expert Solidity auditor with multi-pass analysis', dataSources: ['gpt-5.2', 'function-calling'] },
  { name: 'QuickScan', category: 'code-audit', port: 5002, price: '0.03', quality: 'medium', handler: quickScan, description: 'Quick vulnerability scanner', dataSources: ['gpt-5.2'] },
  { name: 'AuditBot', category: 'code-audit', port: 5003, price: '0.01', quality: 'low', handler: auditBot, description: 'Regex-based pattern matcher (no LLM)', dataSources: ['regex'] },

  // Legal Review (2)
  { name: 'LexGuard', category: 'legal-review', port: 5004, price: '0.06', quality: 'high', handler: lexGuard, description: 'DeFi legal analyst with clause-by-clause review', dataSources: ['gpt-5.2', 'function-calling'] },
  { name: 'ContractEye', category: 'legal-review', port: 5005, price: '0.02', quality: 'low', handler: contractEye, description: 'Generic contract summarizer', dataSources: ['gpt-5.2'] },

  // IP/Patent (3)
  { name: 'PatentHawk', category: 'ip-patent', port: 5006, price: '0.06', quality: 'high', handler: patentHawk, description: 'Patent research with web search', dataSources: ['gpt-5.2', 'web-search'] },
  { name: 'PriorArt', category: 'ip-patent', port: 5007, price: '0.03', quality: 'medium', handler: priorArt, description: 'Prior art finder', dataSources: ['gpt-5.2', 'web-search'] },
  { name: 'PatentLite', category: 'ip-patent', port: 5008, price: '0.01', quality: 'low', handler: patentLite, description: 'Basic search link generator (no LLM)', dataSources: ['fetch'] },

  // DeFi Strategy (2)
  { name: 'YieldSage', category: 'defi-strategy', port: 5009, price: '0.05', quality: 'high', handler: yieldSage, description: 'Multi-source DeFi strategist', dataSources: ['pyth', 'coingecko', 'defillama', 'gpt-5.2'] },
  { name: 'AlphaQuick', category: 'defi-strategy', port: 5010, price: '0.02', quality: 'medium', handler: alphaQuick, description: 'Quick DeFi advisor', dataSources: ['coingecko', 'gpt-5.2'] },
];

// Helper: get agents for a specific category
export function getAgentsByCategory(category: AgentCategory): AgentRegistryEntry[] {
  return AGENT_REGISTRY.filter(a => a.category === category);
}

// Helper: get a single agent by name
export function getAgentByName(name: string): AgentRegistryEntry | undefined {
  return AGENT_REGISTRY.find(a => a.name === name);
}

// Helper: build TwinkleProviderConfig from registry entry + wallet
export function toProviderConfig(
  agent: AgentRegistryEntry,
  privateKey: string,
  address: string,
): TwinkleProviderConfig {
  return {
    name: agent.name,
    port: agent.port,
    price: agent.price,
    quality: agent.quality,
    dataSources: agent.dataSources,
    privateKey,
    address,
    category: agent.category,
    handler: agent.handler,
    description: agent.description,
  };
}
