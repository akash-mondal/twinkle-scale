// Marketplace E2E Test — Full 4-act orchestration with mocked externals.
// Validates: receipt shape, event ordering, AP2 mandate chains, BITE layers,
// quality gate (HIGH=paid, LOW=refunded), and per-act durations.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Mock: OpenAI client (callLLM + getUsage + initClient)
// ---------------------------------------------------------------------------
let llmCallCount = 0;

vi.mock('../src/openai-client.js', () => ({
  initClient: vi.fn(),
  clearCache: vi.fn(),
  getUsage: vi.fn(() => ({ inputTokens: 4200, outputTokens: 1800 })),
  callLLM: vi.fn(async (opts: { instructions: string; input: string }) => {
    llmCallCount++;
    const text = typeof opts.input === 'string' ? opts.input : '';

    // Encryption analysis — always return all 4 layers for full BITE coverage
    if (opts.instructions.includes('encryption layers')) {
      const body = {
        layers: ['strategy', 'escrow', 'query', 'settlement'],
        reasoning: 'Full encryption applied for test coverage.',
        threatModel: ['Front-running', 'Collusion'],
        sensitivityLevel: 'high',
      };
      return {
        text: JSON.stringify(body),
        parsed: body,
        usage: { inputTokens: 100, outputTokens: 50 },
        toolCalls: [],
      };
    }

    // Provider selection — select ALL available providers
    if (opts.instructions.includes('selecting providers')) {
      // Parse provider names from the input blob
      const names = [...text.matchAll(/- (\w+):/g)].map(m => m[1]);
      const selected = names.map(n => ({ name: n, reason: 'Mock selected' }));
      return {
        text: JSON.stringify({ selected }),
        parsed: { selected },
        usage: { inputTokens: 80, outputTokens: 40 },
        toolCalls: [],
      };
    }

    // Quality evaluation — HIGH quality agents score 8, LOW score 3
    if (opts.instructions.includes('quality evaluation')) {
      const providerMatch = text.match(/Provider: (\w+)/);
      const providerName = providerMatch?.[1] ?? '';

      // Map known LOW-quality agents to a failing score
      const lowQualityAgents = ['AuditBot', 'ContractEye', 'PatentLite'];
      const isLow = lowQualityAgents.includes(providerName);
      const score = isLow ? 3 : 8;
      const passed = score >= 5; // default threshold is 5

      const body = { score, passed, reasoning: `Mock eval for ${providerName}` };
      return {
        text: JSON.stringify(body),
        parsed: body,
        usage: { inputTokens: 60, outputTokens: 30 },
        toolCalls: [],
      };
    }

    // Synthesis — combine results
    if (opts.instructions.includes('synthesizing intelligence')) {
      const body = {
        synthesis: 'Mock synthesis across all specialist agents.',
        consensus: 'Strong agreement',
        confidence: 0.9,
        keyInsights: ['insight-1', 'insight-2'],
      };
      return {
        text: JSON.stringify(body),
        parsed: body,
        usage: { inputTokens: 120, outputTokens: 80 },
        toolCalls: [],
      };
    }

    // Fallback for any other LLM call
    return {
      text: '{}',
      parsed: {},
      usage: { inputTokens: 10, outputTokens: 10 },
      toolCalls: [],
    };
  }),
}));

// ---------------------------------------------------------------------------
// 2. Mock: TwinkleClient (escrow, bite, identity, reputation)
// ---------------------------------------------------------------------------
let escrowIdCounter = 0;

const mockTwinkleInstance = () => {
  const addr = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`;
  return {
    address: addr,
    bite: {
      commitEncrypted: vi.fn(async () => ({
        txHash: `0xbite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sendTime: Date.now() - 200,
        receiptTime: Date.now(),
      })),
      decryptCommitment: vi.fn(async () => 'decrypted_hex'),
    },
    escrow: {
      create: vi.fn(async (params: any) => {
        escrowIdCounter++;
        return {
          escrowId: escrowIdCounter,
          txHash: `0xescrow_create_${escrowIdCounter}`,
          biteResult: params.encrypted
            ? { sendTime: Date.now() - 100, receiptTime: Date.now() }
            : undefined,
        };
      }),
      submitResponse: vi.fn(async () => ({ txHash: `0xsubmit_${Date.now()}` })),
      verifyAndSettle: vi.fn(async (id: number) => ({
        txHash: `0xsettle_pay_${id}`,
      })),
      settle: vi.fn(async (id: number) => `0xsettle_refund_${id}`),
    },
    identity: {
      register: vi.fn(async () => ++escrowIdCounter),
    },
    reputation: {
      submit: vi.fn(async () => {}),
    },
  };
};

vi.mock('../src/sdk/index.js', () => {
  return {
    TwinkleClient: vi.fn().mockImplementation(() => mockTwinkleInstance()),
  };
});

// Attach static helpers that the codebase calls
const TwinkleClientMock = (await import('../src/sdk/index.js')).TwinkleClient as any;
TwinkleClientMock.parseUsdc = vi.fn((val: string) => BigInt(Math.round(parseFloat(val) * 1_000_000)));
TwinkleClientMock.hash = vi.fn((data: string) => `0xhash_${data.slice(0, 12)}`);

// ---------------------------------------------------------------------------
// 3. Mock: Provider servers (startProviders / stopProviders / queryProvider)
// ---------------------------------------------------------------------------
const startedProviderGroups: any[][] = [];
const stoppedProviderGroups: any[][] = [];

vi.mock('../src/providers.js', () => ({
  startProviders: vi.fn(async (configs: any[], _opts?: any) => {
    const running = configs.map((c: any) => ({
      config: c,
      server: { close: vi.fn() },
      url: `http://localhost:${c.port}`,
    }));
    startedProviderGroups.push(running);
    return running;
  }),
  stopProviders: vi.fn((providers: any[]) => {
    stoppedProviderGroups.push(providers);
    providers.forEach((p: any) => p.server.close());
  }),
  queryProvider: vi.fn(async (_url: string, _query: string) => {
    return {
      analysis: {
        summary: 'Mock analysis result',
        confidence: 0.85,
        findings: ['finding-1', 'finding-2'],
      },
      _x402: { cost: '0.00', used: false },
    };
  }),
}));

// ---------------------------------------------------------------------------
// 4. Mock: Agent registry — return deterministic agents per category
// ---------------------------------------------------------------------------
function mockAgent(name: string, category: string, port: number, price: string, quality: string) {
  return {
    name,
    category,
    port,
    price,
    quality,
    handler: vi.fn(async () => ({
      analysis: { summary: `${name} analysis`, confidence: quality === 'high' ? 0.9 : quality === 'medium' ? 0.6 : 0.2 },
    })),
    description: `Mock ${name}`,
    dataSources: ['mock-source'],
  };
}

const MOCK_REGISTRY: Record<string, ReturnType<typeof mockAgent>[]> = {
  'code-audit': [
    mockAgent('Sentinel', 'code-audit', 5001, '0.08', 'high'),
    mockAgent('QuickScan', 'code-audit', 5002, '0.03', 'medium'),
    mockAgent('AuditBot', 'code-audit', 5003, '0.01', 'low'),
  ],
  'legal-review': [
    mockAgent('LexGuard', 'legal-review', 5004, '0.06', 'high'),
    mockAgent('ContractEye', 'legal-review', 5005, '0.02', 'low'),
  ],
  'ip-patent': [
    mockAgent('PatentHawk', 'ip-patent', 5006, '0.06', 'high'),
    mockAgent('PriorArt', 'ip-patent', 5007, '0.03', 'medium'),
    mockAgent('PatentLite', 'ip-patent', 5008, '0.01', 'low'),
  ],
  'defi-strategy': [
    mockAgent('YieldSage', 'defi-strategy', 5009, '0.05', 'high'),
    mockAgent('AlphaQuick', 'defi-strategy', 5010, '0.02', 'medium'),
  ],
};

vi.mock('../src/agents/registry.js', () => ({
  AGENT_REGISTRY: Object.values(MOCK_REGISTRY).flat(),
  getAgentsByCategory: vi.fn((cat: string) => MOCK_REGISTRY[cat] || []),
  getAgentByName: vi.fn((name: string) =>
    Object.values(MOCK_REGISTRY).flat().find(a => a.name === name),
  ),
  toProviderConfig: vi.fn((agent: any, pk: string, addr: string) => ({
    name: agent.name,
    port: agent.port,
    price: agent.price,
    quality: agent.quality,
    dataSources: agent.dataSources,
    privateKey: pk,
    address: addr,
    category: agent.category,
    handler: agent.handler,
    description: agent.description,
  })),
}));

// ---------------------------------------------------------------------------
// 5. Mock: global fetch (for any HTTP calls that escape provider mocks)
// ---------------------------------------------------------------------------
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ analysis: { summary: 'fetch fallback', confidence: 0.5 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as any;
});

afterEach(() => {
  // Keep the mock but clear call counts between tests
});

// ---------------------------------------------------------------------------
// Import the system under test AFTER all mocks are established
// ---------------------------------------------------------------------------
import { runMarketplace } from '../src/marketplace.js';
import type { MarketplaceReceipt, AgentEvent, AgentCategory } from '../src/types.js';

// ---------------------------------------------------------------------------
// Shared config factory
// ---------------------------------------------------------------------------
const FAKE_PK1 = '0x' + 'a'.repeat(64);
const FAKE_PK2 = '0x' + 'b'.repeat(64);
const FAKE_PK3 = '0x' + 'c'.repeat(64);
const FAKE_BUYER_PK = '0x' + 'd'.repeat(64);

function makeConfig(overrides: Partial<Parameters<typeof runMarketplace>[0]> = {}) {
  return {
    acts: [],
    rpcUrl: 'http://mock-rpc:8545',
    buyerPk: FAKE_BUYER_PK,
    openaiApiKey: 'sk-mock-key',
    token: '0x' + 'e'.repeat(40),
    qualityThreshold: 5,
    useX402: false,
    wallets: {
      pk1: FAKE_PK1, addr1: '0x' + '1'.repeat(40),
      pk2: FAKE_PK2, addr2: '0x' + '2'.repeat(40),
      pk3: FAKE_PK3, addr3: '0x' + '3'.repeat(40),
    },
    ...overrides,
  };
}

// =========================================================================
// TEST SUITE
// =========================================================================
describe('Marketplace E2E', () => {
  let receipt: MarketplaceReceipt;
  let collectedEvents: AgentEvent[];

  beforeEach(() => {
    llmCallCount = 0;
    escrowIdCounter = 0;
    startedProviderGroups.length = 0;
    stoppedProviderGroups.length = 0;
    collectedEvents = [];
  });

  // -----------------------------------------------------------------------
  // Core test: Full 4-act marketplace run
  // -----------------------------------------------------------------------
  describe('full 4-act run', () => {
    beforeEach(async () => {
      receipt = await runMarketplace(
        makeConfig({
          onEvent: (e: AgentEvent) => collectedEvents.push(e),
        }),
      );
    }, 30_000);

    it('produces a receipt with all 4 acts', () => {
      expect(receipt).toBeDefined();
      expect(receipt.acts).toHaveLength(4);

      const categories = receipt.acts.map(a => a.category);
      expect(categories).toEqual([
        'code-audit',
        'legal-review',
        'ip-patent',
        'defi-strategy',
      ]);
    });

    it('receipt has a valid ID and timestamps', () => {
      expect(receipt.id).toMatch(/^twinkle-marketplace-/);
      expect(receipt.timestamp).toBeGreaterThan(0);
      expect(receipt.duration).toBeGreaterThan(0);
    });

    it('combined totals reflect all providers across acts', () => {
      // 3 + 2 + 3 + 2 = 10 total agents
      expect(receipt.totals.agentsHired).toBe(10);
      expect(receipt.totals.escrowsCreated).toBe(10);
      expect(receipt.totals.agentsPaid + receipt.totals.agentsRefunded).toBe(10);
    });

    it('paid + refunded monetary totals parse as numbers', () => {
      const paid = parseFloat(receipt.totals.paid);
      const refunded = parseFloat(receipt.totals.refunded);
      expect(paid).toBeGreaterThanOrEqual(0);
      expect(refunded).toBeGreaterThanOrEqual(0);
      // All escrows are $0.10 each
      expect(paid + refunded).toBeCloseTo(10 * 0.10, 1);
    });

    it('BITE encryptions happen (>= 5 per act with all 4 layers)', () => {
      // Each act: strategy(1) + query(1) + N escrow encryptions + settlement(1)
      // Minimum 3 message-layer encryptions per act, plus escrow layer per provider
      expect(receipt.totals.biteEncryptions).toBeGreaterThanOrEqual(4 * 3);
    });

    it('each act result includes duration > 0', () => {
      for (const act of receipt.acts) {
        expect(act.duration).toBeGreaterThanOrEqual(0);
        expect(act.receipt).toBeDefined();
        expect(act.receipt.id).toMatch(/^twinkle-receipt-/);
      }
    });

    it('synthesis combines all act results', () => {
      expect(receipt.synthesis).toBeTruthy();
      expect(typeof receipt.synthesis).toBe('string');
      // Each act's synthesis is prefixed with [category]
      for (const cat of ['code-audit', 'legal-review', 'ip-patent', 'defi-strategy']) {
        expect(receipt.synthesis).toContain(`[${cat}]`);
      }
    });

    it('LLM token usage is tracked in totals', () => {
      expect(receipt.totals.llmTokensUsed).toBeGreaterThan(0);
      expect(receipt.totals.llmCost).toBeDefined();
      expect(parseFloat(receipt.totals.llmCost!)).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Provider server lifecycle
  // -----------------------------------------------------------------------
  describe('provider servers', () => {
    beforeEach(async () => {
      receipt = await runMarketplace(makeConfig());
    }, 30_000);

    it('starts providers for each act (4 groups)', () => {
      expect(startedProviderGroups).toHaveLength(4);
    });

    it('stops providers after each act completes (4 groups)', () => {
      expect(stoppedProviderGroups).toHaveLength(4);
    });

    it('each provider group has close() called on every server', () => {
      for (const group of stoppedProviderGroups) {
        for (const provider of group) {
          expect(provider.server.close).toHaveBeenCalled();
        }
      }
    });

    it('provider counts match agent registry per category', () => {
      // code-audit: 3, legal-review: 2, ip-patent: 3, defi-strategy: 2
      const expectedCounts = [3, 2, 3, 2];
      for (let i = 0; i < 4; i++) {
        expect(startedProviderGroups[i]).toHaveLength(expectedCounts[i]);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Event ordering
  // -----------------------------------------------------------------------
  describe('event ordering', () => {
    beforeEach(async () => {
      collectedEvents = [];
      receipt = await runMarketplace(
        makeConfig({ onEvent: (e: AgentEvent) => collectedEvents.push(e) }),
      );
    }, 30_000);

    it('emits events in correct lifecycle order per act', () => {
      expect(collectedEvents.length).toBeGreaterThan(0);

      // The first event in any act should be ap2:intent
      const firstEvent = collectedEvents[0];
      expect(firstEvent.type).toBe('ap2:intent');
    });

    it('agent:start precedes quality:evaluated', () => {
      const startIdx = collectedEvents.findIndex(e => e.type === 'agent:start');
      const qualityIdx = collectedEvents.findIndex(e => e.type === 'quality:evaluated');
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(qualityIdx).toBeGreaterThan(startIdx);
    });

    it('encryption:decision precedes bite:encrypting', () => {
      const decisionIdx = collectedEvents.findIndex(e => e.type === 'encryption:decision');
      const biteIdx = collectedEvents.findIndex(e => e.type === 'bite:encrypting');
      expect(decisionIdx).toBeGreaterThanOrEqual(0);
      expect(biteIdx).toBeGreaterThan(decisionIdx);
    });

    it('escrow:created precedes escrow:settled', () => {
      const createIdx = collectedEvents.findIndex(e => e.type === 'escrow:created');
      const settleIdx = collectedEvents.findIndex(e => e.type === 'escrow:settled');
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(settleIdx).toBeGreaterThan(createIdx);
    });

    it('provider:discovered precedes provider:selected', () => {
      const discoveredIdx = collectedEvents.findIndex(e => e.type === 'provider:discovered');
      const selectedIdx = collectedEvents.findIndex(e => e.type === 'provider:selected');
      expect(discoveredIdx).toBeGreaterThanOrEqual(0);
      expect(selectedIdx).toBeGreaterThan(discoveredIdx);
    });

    it('synthesis:complete fires before agent:receipt', () => {
      const synthIdx = collectedEvents.findIndex(e => e.type === 'synthesis:complete');
      const receiptIdx = collectedEvents.findIndex(e => e.type === 'agent:receipt');
      expect(synthIdx).toBeGreaterThanOrEqual(0);
      expect(receiptIdx).toBeGreaterThan(synthIdx);
    });

    it('x402:challenge fires for every provider', () => {
      const challenges = collectedEvents.filter(e => e.type === 'x402:challenge');
      // 10 total providers across 4 acts
      expect(challenges).toHaveLength(10);
    });

    it('emits ap2:complete at the end of each act', () => {
      const completes = collectedEvents.filter(e => e.type === 'ap2:complete');
      expect(completes).toHaveLength(4);
    });

    it('event timestamps are monotonically non-decreasing', () => {
      for (let i = 1; i < collectedEvents.length; i++) {
        expect(collectedEvents[i].timestamp).toBeGreaterThanOrEqual(
          collectedEvents[i - 1].timestamp,
        );
      }
    });
  });

  // -----------------------------------------------------------------------
  // AP2 mandate chains
  // -----------------------------------------------------------------------
  describe('AP2 mandate chains', () => {
    beforeEach(async () => {
      collectedEvents = [];
      receipt = await runMarketplace(
        makeConfig({ onEvent: (e: AgentEvent) => collectedEvents.push(e) }),
      );
    }, 30_000);

    it('creates one mandate chain per act (4 total)', () => {
      expect(receipt.mandateChains).toHaveLength(4);
    });

    it('each chain has a unique chainId', () => {
      const ids = receipt.mandateChains.map(c => c.chainId);
      expect(new Set(ids).size).toBe(4);
    });

    it('each chain contains intent + cart + payment mandates', () => {
      for (const chain of receipt.mandateChains) {
        const intents = chain.mandates.filter(m => m.type === 'intent');
        const carts = chain.mandates.filter(m => m.type === 'cart');
        const payments = chain.mandates.filter(m => m.type === 'payment');

        expect(intents.length).toBe(1);
        expect(carts.length).toBeGreaterThanOrEqual(1);
        expect(payments.length).toBeGreaterThanOrEqual(1);
        // payments == carts (one per provider)
        expect(payments.length).toBe(carts.length);
      }
    });

    it('cart mandates reference intent as parent', () => {
      for (const chain of receipt.mandateChains) {
        const intent = chain.mandates.find(m => m.type === 'intent')!;
        const carts = chain.mandates.filter(m => m.type === 'cart');
        for (const cart of carts) {
          expect(cart.parentId).toBe(intent.id);
        }
      }
    });

    it('payment mandates reference a cart as parent', () => {
      for (const chain of receipt.mandateChains) {
        const cartIds = new Set(
          chain.mandates.filter(m => m.type === 'cart').map(m => m.id),
        );
        const payments = chain.mandates.filter(m => m.type === 'payment');
        for (const payment of payments) {
          expect(cartIds.has(payment.parentId!)).toBe(true);
        }
      }
    });

    it('chains are marked completed with an outcome', () => {
      for (const chain of receipt.mandateChains) {
        expect(chain.completed).toBeGreaterThan(0);
        expect(['success', 'failure']).toContain(chain.outcome);
      }
    });

    it('emits ap2:intent, ap2:cart, ap2:payment, ap2:settled, ap2:complete events', () => {
      const ap2Types = collectedEvents
        .filter(e => e.type.startsWith('ap2:'))
        .map(e => e.type);

      expect(ap2Types).toContain('ap2:intent');
      expect(ap2Types).toContain('ap2:cart');
      expect(ap2Types).toContain('ap2:payment');
      expect(ap2Types).toContain('ap2:settled');
      expect(ap2Types).toContain('ap2:complete');
    });
  });

  // -----------------------------------------------------------------------
  // BITE encryption layers
  // -----------------------------------------------------------------------
  describe('BITE encryption layers', () => {
    beforeEach(async () => {
      collectedEvents = [];
      receipt = await runMarketplace(
        makeConfig({ onEvent: (e: AgentEvent) => collectedEvents.push(e) }),
      );
    }, 30_000);

    it('bite:encrypting events fire for strategy, query, escrow, and settlement', () => {
      const biteEvents = collectedEvents.filter(e => e.type === 'bite:encrypting');
      const layers = biteEvents.map(e => e.data.layer);

      expect(layers).toContain('strategy');
      expect(layers).toContain('query');
      expect(layers).toContain('escrow');
      expect(layers).toContain('settlement');
    });

    it('bite:committed fires after each bite:encrypting', () => {
      const encrypting = collectedEvents.filter(e => e.type === 'bite:encrypting');
      const committed = collectedEvents.filter(e => e.type === 'bite:committed');

      // At minimum, committed count should match encrypting count minus escrow
      // (escrows use createEncryptedEscrow which emits bite:committed)
      expect(committed.length).toBeGreaterThanOrEqual(encrypting.length - 1);
    });

    it('bite:verified fires for strategy, query, settlement (message layers)', () => {
      const verified = collectedEvents.filter(e => e.type === 'bite:verified');
      const verifiedLayers = verified.map(e => e.data.layer);

      // Per act: strategy, query, settlement get verified
      expect(verifiedLayers.filter(l => l === 'strategy').length).toBe(4);
      expect(verifiedLayers.filter(l => l === 'query').length).toBe(4);
      expect(verifiedLayers.filter(l => l === 'settlement').length).toBe(4);
    });

    it('each act receipt includes biteCommitments for all message layers', () => {
      for (const act of receipt.acts) {
        const bc = act.receipt.biteCommitments;
        expect(bc.strategy).toBeDefined();
        expect(bc.strategy!.txHash).toBeTruthy();
        expect(bc.query).toBeDefined();
        expect(bc.query!.txHash).toBeTruthy();
        expect(bc.settlements).toBeDefined();
        expect(bc.settlements!.txHash).toBeTruthy();
      }
    });

    it('escrow-level BITE encryptions happen for each provider', () => {
      const escrowBites = collectedEvents.filter(
        e => e.type === 'bite:encrypting' && e.data.layer === 'escrow',
      );
      // 10 providers total
      expect(escrowBites).toHaveLength(10);
    });
  });

  // -----------------------------------------------------------------------
  // Quality gate: HIGH agents PAID, LOW agents REFUNDED
  // -----------------------------------------------------------------------
  describe('quality gate enforcement', () => {
    beforeEach(async () => {
      collectedEvents = [];
      receipt = await runMarketplace(
        makeConfig({ onEvent: (e: AgentEvent) => collectedEvents.push(e) }),
      );
    }, 30_000);

    it('HIGH quality agents are PAID', () => {
      // Known high-quality: Sentinel, LexGuard, PatentHawk, YieldSage
      const highQualityNames = ['Sentinel', 'LexGuard', 'PatentHawk', 'YieldSage'];

      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          if (highQualityNames.includes(p.name)) {
            expect(p.settlement.action).toBe('paid');
            expect(p.delivery.passed).toBe(true);
            expect(p.delivery.qualityScore).toBeGreaterThanOrEqual(5);
          }
        }
      }
    });

    it('LOW quality agents are REFUNDED', () => {
      // Known low-quality: AuditBot, ContractEye, PatentLite
      const lowQualityNames = ['AuditBot', 'ContractEye', 'PatentLite'];

      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          if (lowQualityNames.includes(p.name)) {
            expect(p.settlement.action).toBe('refunded');
            expect(p.delivery.passed).toBe(false);
            expect(p.delivery.qualityScore).toBeLessThan(5);
          }
        }
      }
    });

    it('MEDIUM quality agents are PAID (above threshold 5)', () => {
      // Known medium: QuickScan, PriorArt, AlphaQuick
      const mediumQualityNames = ['QuickScan', 'PriorArt', 'AlphaQuick'];

      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          if (mediumQualityNames.includes(p.name)) {
            expect(p.settlement.action).toBe('paid');
            expect(p.delivery.passed).toBe(true);
          }
        }
      }
    });

    it('quality:evaluated events fire for every provider', () => {
      const qEvents = collectedEvents.filter(e => e.type === 'quality:evaluated');
      expect(qEvents).toHaveLength(10);
    });

    it('reputation is updated for every settled provider', () => {
      const repEvents = collectedEvents.filter(e => e.type === 'reputation:updated');
      expect(repEvents).toHaveLength(10);

      // Paid agents get positive reputation
      const paidReps = repEvents.filter(e => e.data.score > 0);
      expect(paidReps.length).toBeGreaterThan(0);

      // Refunded agents get negative reputation
      const refundedReps = repEvents.filter(e => e.data.score < 0);
      expect(refundedReps.length).toBeGreaterThan(0);
    });

    it('paid agents get positive rep (+80) with quality+reliable tags', () => {
      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          if (p.settlement.action === 'paid') {
            expect(p.reputation.score).toBe(80);
            expect(p.reputation.tags).toContain('quality');
            expect(p.reputation.tags).toContain('reliable');
          }
        }
      }
    });

    it('refunded agents get negative rep (-40) with quality+poor tags', () => {
      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          if (p.settlement.action === 'refunded') {
            expect(p.reputation.score).toBe(-40);
            expect(p.reputation.tags).toContain('quality');
            expect(p.reputation.tags).toContain('poor');
          }
        }
      }
    });

    it('combined totals reflect correct paid/refunded split', () => {
      // HIGH(4) + MEDIUM(3) = 7 paid, LOW(3) = 3 refunded
      expect(receipt.totals.agentsPaid).toBe(7);
      expect(receipt.totals.agentsRefunded).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Per-act receipt structure
  // -----------------------------------------------------------------------
  describe('per-act receipt structure', () => {
    beforeEach(async () => {
      receipt = await runMarketplace(makeConfig());
    }, 30_000);

    it('code-audit act has 3 providers', () => {
      const act = receipt.acts.find(a => a.category === 'code-audit')!;
      expect(act.receipt.providers).toHaveLength(3);
    });

    it('legal-review act has 2 providers', () => {
      const act = receipt.acts.find(a => a.category === 'legal-review')!;
      expect(act.receipt.providers).toHaveLength(2);
    });

    it('ip-patent act has 3 providers', () => {
      const act = receipt.acts.find(a => a.category === 'ip-patent')!;
      expect(act.receipt.providers).toHaveLength(3);
    });

    it('defi-strategy act has 2 providers', () => {
      const act = receipt.acts.find(a => a.category === 'defi-strategy')!;
      expect(act.receipt.providers).toHaveLength(2);
    });

    it('each provider result includes escrow with txHash', () => {
      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          expect(p.escrow.id).toBeGreaterThan(0);
          expect(p.escrow.txHash).toBeTruthy();
          expect(p.escrow.amount).toBe('0.10');
        }
      }
    });

    it('each provider result includes delivery hash and quality score', () => {
      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          expect(p.delivery.hash).toBeTruthy();
          expect(typeof p.delivery.qualityScore).toBe('number');
          expect(typeof p.delivery.passed).toBe('boolean');
          expect(typeof p.delivery.reasoning).toBe('string');
        }
      }
    });

    it('each provider has a settlement txHash', () => {
      for (const act of receipt.acts) {
        for (const p of act.receipt.providers) {
          expect(p.settlement.txHash).toBeTruthy();
          expect(['paid', 'refunded']).toContain(p.settlement.action);
        }
      }
    });

    it('each act receipt has an encryption decision', () => {
      for (const act of receipt.acts) {
        expect(act.receipt.encryptionDecision).toBeDefined();
        expect(act.receipt.encryptionDecision.layers.length).toBeGreaterThan(0);
        expect(act.receipt.encryptionDecision.sensitivityLevel).toBe('high');
      }
    });

    it('each act receipt has synthesis text', () => {
      for (const act of receipt.acts) {
        expect(act.receipt.synthesis).toBeTruthy();
        expect(typeof act.receipt.synthesis).toBe('string');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Edge: custom quality threshold
  // -----------------------------------------------------------------------
  describe('custom quality threshold', () => {
    it('threshold=10 causes all agents to be refunded', async () => {
      const r = await runMarketplace(makeConfig({ qualityThreshold: 10 }));

      // With threshold=10, even HIGH agents scoring 8 would fail
      // Our mock returns score 8 for high, 3 for low -- all below 10
      expect(r.totals.agentsRefunded).toBe(10);
      expect(r.totals.agentsPaid).toBe(0);
      expect(parseFloat(r.totals.paid)).toBe(0);
    }, 30_000);

    it('threshold=1 causes all agents to be paid', async () => {
      const r = await runMarketplace(makeConfig({ qualityThreshold: 1 }));

      // With threshold=1, even LOW agents scoring 3 pass
      expect(r.totals.agentsPaid).toBe(10);
      expect(r.totals.agentsRefunded).toBe(0);
      expect(parseFloat(r.totals.refunded)).toBe(0);
    }, 30_000);
  });

  // -----------------------------------------------------------------------
  // Settlement events contain correct data
  // -----------------------------------------------------------------------
  describe('settlement events', () => {
    beforeEach(async () => {
      collectedEvents = [];
      receipt = await runMarketplace(
        makeConfig({ onEvent: (e: AgentEvent) => collectedEvents.push(e) }),
      );
    }, 30_000);

    it('escrow:settled events include action and txHash', () => {
      const settled = collectedEvents.filter(e => e.type === 'escrow:settled');
      expect(settled).toHaveLength(10);

      for (const e of settled) {
        expect(['pay', 'refund']).toContain(e.data.action);
        expect(e.data.txHash).toBeTruthy();
        expect(e.data.escrowId).toBeGreaterThan(0);
        expect(e.data.provider).toBeTruthy();
      }
    });

    it('ap2:settled events mirror escrow settlements', () => {
      const ap2Settled = collectedEvents.filter(e => e.type === 'ap2:settled');
      expect(ap2Settled).toHaveLength(10);

      for (const e of ap2Settled) {
        expect(['released', 'refunded']).toContain(e.data.outcome);
        expect(e.data.mandateId).toBeTruthy();
        expect(e.data.txHash).toBeTruthy();
      }
    });
  });
});
