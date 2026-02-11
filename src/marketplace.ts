// Marketplace Orchestrator — runs 4 acts sequentially, produces combined receipt.
// Each act = a category (code-audit, legal-review, ip-patent, defi-strategy).

import { runAgent } from './runner.js';
import { startProviders, stopProviders } from './providers.js';
import { getAgentsByCategory, toProviderConfig } from './agents/registry.js';
import { getUsage } from './openai-client.js';
import type {
  AgentCategory,
  ActConfig,
  ActResult,
  MarketplaceConfig,
  MarketplaceReceipt,
  AgentEventHandler,
} from './types.js';
import type { MandateChain } from './ap2-mandates.js';

const ACT_QUERIES: Record<AgentCategory, string> = {
  'code-audit': 'Perform a comprehensive security audit of this Solidity smart contract. Identify all vulnerabilities, rate their severity, and provide fix recommendations.',
  'legal-review': 'Review these Terms of Service for legal risks, consumer protection issues, and regulatory compliance gaps. Identify all red flags.',
  'ip-patent': 'Search for prior art related to threshold encryption for conditional transaction execution on blockchain networks. Assess patentability.',
  'defi-strategy': 'Analyze SOL for institutional positioning. Provide protocol allocation strategy with risk tiers and rebalance triggers.',
};

const ACT_BUDGETS: Record<AgentCategory, string> = {
  'code-audit': '0.15',
  'legal-review': '0.10',
  'ip-patent': '0.12',
  'defi-strategy': '0.10',
};

// Wallet assignments — 3 wallets cycle across acts
interface WalletSet {
  pk1: string; addr1: string;
  pk2: string; addr2: string;
  pk3: string; addr3: string;
}

export async function runMarketplace(
  config: MarketplaceConfig & { wallets: WalletSet },
): Promise<MarketplaceReceipt> {
  const startTime = Date.now();
  const acts: ActResult[] = [];
  const mandateChains: MandateChain[] = [];

  const categories: AgentCategory[] = ['code-audit', 'legal-review', 'ip-patent', 'defi-strategy'];

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║         TWINKLE MARKETPLACE — 4 ACT DEMO         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    const agents = getAgentsByCategory(category);
    const query = ACT_QUERIES[category];
    const budget = ACT_BUDGETS[category];

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  ACT ${i + 1}: ${category.toUpperCase()}`);
    console.log(`  Agents: ${agents.map(a => a.name).join(', ')}`);
    console.log(`  Budget: $${budget} USDC`);
    console.log(`${'═'.repeat(55)}`);

    // Build provider configs with wallet assignments
    const wallets = [
      { pk: config.wallets.pk1, addr: config.wallets.addr1 },
      { pk: config.wallets.pk2, addr: config.wallets.addr2 },
      { pk: config.wallets.pk3, addr: config.wallets.addr3 },
    ];

    const providerConfigs = agents.map((agent, j) => {
      const wallet = wallets[j % wallets.length];
      return toProviderConfig(agent, wallet.pk, wallet.addr);
    });

    // Start provider servers for this act
    const providers = await startProviders(providerConfigs, {
      useX402: config.useX402,
    });
    await new Promise(r => setTimeout(r, 500));

    const actStart = Date.now();

    try {
      const receipt = await runAgent({
        query,
        budget,
        rpcUrl: config.rpcUrl,
        buyerPk: config.buyerPk,
        providerConfigs,
        openaiApiKey: config.openaiApiKey,
        token: config.token,
        qualityThreshold: config.qualityThreshold ?? 5,
        useX402: config.useX402,
        category,
        onEvent: config.onEvent,
      });

      acts.push({
        category,
        receipt,
        duration: Date.now() - actStart,
      });

      if (receipt.mandateChain) {
        mandateChains.push(receipt.mandateChain);
      }
    } finally {
      stopProviders(providers);
      console.log(`\n  [Act ${i + 1}] Provider servers stopped.`);
    }
  }

  // Build combined receipt
  const usage = getUsage();
  const totalPaid = acts.reduce((s, a) => s + parseFloat(a.receipt.totals.paid), 0);
  const totalRefunded = acts.reduce((s, a) => s + parseFloat(a.receipt.totals.refunded), 0);
  const totalEscrows = acts.reduce((s, a) => s + a.receipt.totals.escrowsCreated, 0);
  const totalBite = acts.reduce((s, a) => s + a.receipt.totals.biteEncryptions, 0);
  const totalX402 = acts.reduce((s, a) => s + a.receipt.totals.x402Payments, 0);
  const agentsPaid = acts.reduce((s, a) => s + a.receipt.providers.filter(p => p.settlement.action === 'paid').length, 0);
  const agentsRefunded = acts.reduce((s, a) => s + a.receipt.providers.filter(p => p.settlement.action === 'refunded').length, 0);

  const synthesis = acts
    .map(a => `[${a.category}] ${a.receipt.synthesis}`)
    .join('\n\n');

  const marketplaceReceipt: MarketplaceReceipt = {
    id: `twinkle-marketplace-${Date.now()}`,
    timestamp: startTime,
    duration: Date.now() - startTime,
    acts,
    totals: {
      escrowsCreated: totalEscrows,
      paid: totalPaid.toFixed(2),
      refunded: totalRefunded.toFixed(2),
      biteEncryptions: totalBite,
      x402Payments: totalX402,
      agentsHired: totalEscrows,
      agentsPaid,
      agentsRefunded,
      llmTokensUsed: usage.inputTokens + usage.outputTokens,
      llmCost: ((usage.inputTokens * 1.75 + usage.outputTokens * 14) / 1_000_000).toFixed(4),
    },
    mandateChains,
    synthesis,
  };

  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║              MARKETPLACE COMPLETE                 ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log(`  Duration: ${(marketplaceReceipt.duration / 1000).toFixed(1)}s`);
  console.log(`  Acts: ${acts.length}`);
  console.log(`  Agents: ${totalEscrows} hired, ${agentsPaid} paid, ${agentsRefunded} refunded`);
  console.log(`  BITE: ${totalBite} encryptions`);
  console.log(`  x402: ${totalX402} payments`);
  console.log(`  Paid: $${totalPaid.toFixed(2)} | Refunded: $${totalRefunded.toFixed(2)}`);
  console.log(`  LLM: ${usage.inputTokens + usage.outputTokens} tokens ($${marketplaceReceipt.totals.llmCost})`);

  return marketplaceReceipt;
}
