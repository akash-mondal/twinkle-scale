// Agent Runner — The main orchestration loop.
// Integrates all 5 technologies: BITE + x402 + AP2 + ERC-8004 + Escrow.

import { TwinkleClient } from './sdk/index.js';
import { AgentEventEmitter } from './events.js';
import { BiteLayers } from './bite-layers.js';
import { AgentBrain } from './brain.js';
import { queryProvider } from './providers.js';
import { buildReceipt } from './receipts.js';
import { MandateTracker } from './ap2-mandates.js';
import type { CartMandate, PaymentMandate } from './ap2-mandates.js';
import type {
  AgentRunConfig,
  AgentReceipt,
  ProviderResult,
  BiteLayerResult,
} from './types.js';

export async function runAgent(config: AgentRunConfig): Promise<AgentReceipt> {
  const startTime = Date.now();
  const events = new AgentEventEmitter();
  if (config.onEvent) events.onEvent(config.onEvent);

  const qualityThreshold = config.qualityThreshold ?? 5;
  const useX402 = config.useX402 ?? false;

  const buyer = new TwinkleClient({ rpcUrl: config.rpcUrl, privateKey: config.buyerPk });
  const brain = new AgentBrain();
  const biteLayers = new BiteLayers(buyer, events);
  const mandates = new MandateTracker();

  // Phase 0: AP2 Intent Mandate
  console.log('\n[Phase 0] AP2 Intent Mandate...');
  const intentMandate = mandates.createIntent({
    description: config.query,
    budget: config.budget,
    asset: 'USDC',
    ttl: 600,
  });

  events.emit('ap2:intent', 'mandate-tracking', {
    mandateId: intentMandate.id,
    chainId: mandates.getChain().chainId,
    description: intentMandate.description,
    budget: intentMandate.budget,
  });

  console.log(`  Chain: ${mandates.getChain().chainId}`);
  console.log(`  Intent: ${intentMandate.id} — budget $${config.budget} USDC`);

  events.emit('agent:start', 'initialization', {
    query: config.query,
    budget: config.budget,
    buyerAddress: buyer.address,
    providerCount: config.providerConfigs.length,
    useX402,
    category: config.category,
    mandateChainId: mandates.getChain().chainId,
  });

  // Phase 1: Encryption Analysis
  console.log('\n[Phase 1] Encryption Analysis — LLM threat modeling...');
  const encryptionDecision = await brain.analyzeEncryptionNeeds(config.query);

  events.emit('encryption:decision', 'encryption-analysis', {
    layers: encryptionDecision.layers,
    reasoning: encryptionDecision.reasoning,
    threatModel: encryptionDecision.threatModel,
    sensitivityLevel: encryptionDecision.sensitivityLevel,
  });

  console.log(`  Sensitivity: ${encryptionDecision.sensitivityLevel}`);
  console.log(`  Layers: ${encryptionDecision.layers.join(', ')}`);

  // Phase 2: BITE Layer 1 — Strategy Commitment
  let strategyCommit: BiteLayerResult | undefined;

  if (encryptionDecision.layers.includes('strategy')) {
    console.log('\n[Phase 2] BITE Layer 1 — Strategy Commitment...');
    const strategy = {
      query: config.query,
      budget: config.budget,
      providers: config.providerConfigs.map(p => ({
        name: p.name,
        price: p.price,
        endpoint: `http://localhost:${p.port}`,
      })),
      qualityThreshold,
      useX402,
      timestamp: Date.now(),
    };

    strategyCommit = await biteLayers.commitStrategy(strategy);
    console.log(`  Committed: ${strategyCommit.txHash}`);
    console.log(`  Verified: ${strategyCommit.verified}`);
  }

  // Phase 3: BITE Layer 3 — Encrypted Query
  let queryCommit: BiteLayerResult | undefined;

  if (encryptionDecision.layers.includes('query')) {
    console.log('\n[Phase 3] BITE Layer 3 — Encrypted Query...');
    queryCommit = await biteLayers.commitQuery(config.query);
    console.log(`  Committed: ${queryCommit.txHash}`);
    console.log(`  Verified: ${queryCommit.verified}`);
  }

  // Phase 4: Provider Discovery + AP2 Cart Mandates
  console.log('\n[Phase 4] Provider Discovery...');
  const providerClients: Array<{ client: TwinkleClient; agentId: number; config: typeof config.providerConfigs[0] }> = [];

  for (const pc of config.providerConfigs) {
    const providerClient = new TwinkleClient({ rpcUrl: config.rpcUrl, privateKey: pc.privateKey });
    const agentId = await providerClient.identity.register({
      uri: `twinkle://${pc.name.toLowerCase()}`,
      metadata: {
        name: pc.name,
        capability: pc.dataSources.join(','),
        price: pc.price,
      },
    });

    events.emit('provider:discovered', 'discovery', {
      name: pc.name,
      agentId,
      address: providerClient.address,
      price: pc.price,
    });

    console.log(`  Registered: ${pc.name} (agentId: ${agentId}, $${pc.price})`);
    providerClients.push({ client: providerClient, agentId, config: pc });
  }

  const selected = await brain.selectProviders(
    config.providerConfigs.map(p => ({
      name: p.name,
      price: p.price,
      capabilities: p.dataSources,
    })),
    config.budget,
    config.query,
  );

  events.emit('provider:selected', 'discovery', {
    selected: selected.map(s => s.name),
    reasons: selected.map(s => ({ name: s.name, reason: s.reason })),
  });

  const cartMandates = new Map<string, CartMandate>();
  for (const pp of providerClients) {
    const cart = mandates.createCart({
      provider: pp.client.address,
      providerName: pp.config.name,
      price: pp.config.price,
      asset: 'USDC',
      service: config.category || 'data-query',
      x402Endpoint: `http://localhost:${pp.config.port}`,
    });
    cartMandates.set(pp.config.name, cart);

    events.emit('ap2:cart', 'mandate-tracking', {
      mandateId: cart.id,
      parentId: cart.parentId,
      provider: cart.providerName,
      price: cart.totalPrice,
    });

    console.log(`  AP2 Cart: ${pp.config.name} → ${cart.id.slice(-12)}`);
  }

  // Phase 5: Data Purchase
  console.log(`\n[Phase 5] Data Purchase${useX402 ? ' [x402]' : ''}...`);
  const deliveries: Array<{ provider: typeof providerClients[0]; data: any; x402Meta?: { cost: string; used: boolean } }> = [];

  for (const pp of providerClients) {
    const endpoint = `http://localhost:${pp.config.port}`;

    events.emit('x402:challenge', 'data-purchase', {
      provider: pp.config.name,
      endpoint,
      price: pp.config.price,
      useX402,
    });

    try {
      const result = await queryProvider(
        endpoint,
        config.query,
        useX402 ? config.buyerPk : undefined,
      );

      const x402Meta = result._x402 || { cost: '0', used: false };
      delete result._x402;

      if (useX402 && x402Meta.used) {
        events.emit('x402:payment', 'data-purchase', {
          provider: pp.config.name,
          cost: x402Meta.cost,
          method: 'EIP-3009 transferWithAuthorization',
        });
      }

      events.emit('x402:success', 'data-purchase', {
        provider: pp.config.name,
        hasAnalysis: !!result.analysis,
        x402Used: x402Meta.used,
        x402Cost: x402Meta.cost,
      });

      console.log(`  ${pp.config.name}: received analysis (confidence: ${result.analysis?.confidence})${x402Meta.used ? ` [x402 paid $${x402Meta.cost}]` : ''}`);
      deliveries.push({ provider: pp, data: result, x402Meta });
    } catch (err: any) {
      events.emit('agent:error', 'data-purchase', {
        provider: pp.config.name,
        error: err.message,
      });
      console.log(`  ${pp.config.name}: FAILED — ${err.message}`);
    }
  }

  // Phase 6: BITE Layer 2 — Encrypted Escrows + AP2 Payment Mandates
  console.log('\n[Phase 6] BITE Layer 2 — Encrypted Escrows...');
  const escrowResults: Array<{
    delivery: typeof deliveries[0];
    escrowId: number;
    biteResult: BiteLayerResult;
    deliveryHash: string;
  }> = [];

  const paymentMandateMap = new Map<number, string>();
  const escrowAmount = TwinkleClient.parseUsdc('0.10');

  for (const d of deliveries) {
    const requestHash = TwinkleClient.hash(`${config.query}-${d.provider.config.name}-${Date.now()}`);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const useEncryption = encryptionDecision.layers.includes('escrow');

    let escrowId: number;
    let biteResult: BiteLayerResult;

    if (useEncryption) {
      const result = await biteLayers.createEncryptedEscrow({
        seller: d.provider.client.address,
        token: config.token,
        amount: escrowAmount,
        deadline,
        requestHash,
        encrypted: true,
      });
      escrowId = result.escrowId;
      biteResult = result.biteResult;
    } else {
      const result = await buyer.escrow.create({
        seller: d.provider.client.address,
        token: config.token,
        amount: escrowAmount,
        deadline,
        requestHash,
        encrypted: false,
      });
      escrowId = result.escrowId;
      biteResult = {
        layer: 'escrow',
        txHash: result.txHash,
        encrypted: false,
        timing: { sendMs: 0, receiptMs: 0 },
        dataPreview: `escrow:${escrowId}`,
      };
    }

    const deliveryHash = TwinkleClient.hash(JSON.stringify(d.data.analysis));

    events.emit('escrow:created', 'escrow-creation', {
      provider: d.provider.config.name,
      escrowId,
      amount: '0.10',
      biteEncrypted: useEncryption,
      txHash: biteResult.txHash,
    });

    const cart = cartMandates.get(d.provider.config.name)!;
    const paymentMandate = mandates.createPayment({
      cartId: cart.id,
      escrowId,
      txHash: biteResult.txHash,
      amount: '0.10',
      asset: 'USDC',
      provider: d.provider.client.address,
      x402Cost: d.x402Meta?.cost,
    });
    paymentMandateMap.set(escrowId, paymentMandate.id);

    events.emit('ap2:payment', 'mandate-tracking', {
      mandateId: paymentMandate.id,
      parentId: paymentMandate.parentId,
      escrowId,
      status: 'locked',
    });

    console.log(`  ${useEncryption ? '[BITE]' : '[plain]'} → ${d.provider.config.name} ($0.10) — Escrow #${escrowId}`);
    escrowResults.push({ delivery: d, escrowId, biteResult, deliveryHash });
  }

  // Phase 7: Delivery + Quality Gate
  console.log('\n[Phase 7] Delivery + Quality Evaluation...');
  const providerResults: ProviderResult[] = [];
  const settlementDecisions: Array<{ escrowId: number; action: 'pay' | 'refund'; score: number }> = [];

  for (const er of escrowResults) {
    const pp = er.delivery.provider;
    const analysis = er.delivery.data.analysis;

    await pp.client.escrow.submitResponse(er.escrowId, er.deliveryHash);

    events.emit('escrow:response', 'delivery', {
      provider: pp.config.name,
      escrowId: er.escrowId,
      deliveryHash: er.deliveryHash,
    });

    const quality = await brain.evaluateQualityForCategory(
      analysis,
      pp.config.name,
      qualityThreshold,
      config.category,
    );

    events.emit('quality:evaluated', 'quality-gate', {
      provider: pp.config.name,
      score: quality.score,
      passed: quality.passed,
      reasoning: quality.reasoning,
    });

    console.log(`  ${pp.config.name}: score ${quality.score}/10 — ${quality.passed ? 'PASSED' : 'FAILED'}`);

    settlementDecisions.push({
      escrowId: er.escrowId,
      action: quality.passed ? 'pay' : 'refund',
      score: quality.score,
    });

    const x402Meta = er.delivery.x402Meta || { cost: '0', used: false };

    providerResults.push({
      name: pp.config.name,
      agentId: pp.agentId,
      address: pp.client.address,
      x402: {
        amount: pp.config.price,
        paid: true,
        endpoint: `http://localhost:${pp.config.port}`,
        x402Used: x402Meta.used,
        x402Cost: x402Meta.cost,
      },
      escrow: {
        id: er.escrowId,
        amount: '0.10',
        biteEncrypted: er.biteResult.encrypted,
        txHash: er.biteResult.txHash,
        timing: {
          sendMs: er.biteResult.timing.sendMs,
          receiptMs: er.biteResult.timing.receiptMs,
        },
      },
      delivery: {
        hash: er.deliveryHash,
        qualityScore: quality.score,
        passed: quality.passed,
        reasoning: quality.reasoning,
        analysis,
      },
      settlement: { action: quality.passed ? 'paid' : 'refunded', txHash: '' },
      reputation: { score: 0, tags: [] },
    });
  }

  // Phase 8: BITE Layer 4 — Encrypted Settlement Batch
  let settlementsCommit: BiteLayerResult | undefined;

  if (encryptionDecision.layers.includes('settlement')) {
    console.log('\n[Phase 8] BITE Layer 4 — Encrypted Settlement Batch...');
    settlementsCommit = await biteLayers.commitSettlements(settlementDecisions);
    console.log(`  Committed: ${settlementsCommit.txHash}`);
    console.log(`  Verified: ${settlementsCommit.verified}`);
  } else {
    console.log('\n[Phase 8] Settlement...');
  }

  for (let i = 0; i < escrowResults.length; i++) {
    const er = escrowResults[i];
    const pr = providerResults[i];
    const decision = settlementDecisions[i];
    const paymentMandateId = paymentMandateMap.get(er.escrowId)!;

    if (decision.action === 'pay') {
      const result = await buyer.escrow.verifyAndSettle(er.escrowId, er.deliveryHash);
      pr.settlement.txHash = result.txHash;
      mandates.settlePayment(paymentMandateId, 'released', result.txHash);
      console.log(`  ${pr.name}: PAID $0.10 (escrow #${er.escrowId})`);
    } else {
      const txHash = await buyer.escrow.settle(er.escrowId, false);
      pr.settlement.txHash = txHash;
      mandates.settlePayment(paymentMandateId, 'refunded', txHash);
      console.log(`  ${pr.name}: REFUNDED $0.10 (escrow #${er.escrowId})`);
    }

    events.emit('escrow:settled', 'settlement', {
      provider: pr.name,
      escrowId: er.escrowId,
      action: decision.action,
      txHash: pr.settlement.txHash,
    });

    events.emit('ap2:settled', 'mandate-tracking', {
      mandateId: paymentMandateId,
      escrowId: er.escrowId,
      outcome: decision.action === 'pay' ? 'released' : 'refunded',
      txHash: pr.settlement.txHash,
    });

    const repScore = decision.action === 'pay' ? 80 : -40;
    const tags = decision.action === 'pay' ? ['quality', 'reliable'] : ['quality', 'poor'];
    await buyer.reputation.submit({
      agentId: pr.agentId,
      value: repScore,
      tag1: tags[0],
      tag2: tags[1],
    });
    pr.reputation = { score: repScore, tags };

    events.emit('reputation:updated', 'settlement', {
      provider: pr.name,
      agentId: pr.agentId,
      score: repScore,
      tags,
    });
  }

  // Phase 9: Synthesis
  console.log('\n[Phase 9] Synthesis...');
  const passingResults = providerResults.filter(p => p.delivery.passed);

  let synthesis = 'No passing results to synthesize.';
  if (passingResults.length > 0) {
    synthesis = await brain.synthesize(
      passingResults.map(p => ({ name: p.name, analysis: p.delivery.analysis })),
      config.query,
    );
    console.log(`  Synthesized ${passingResults.length} results`);
  }

  events.emit('synthesis:complete', 'synthesis', {
    inputCount: passingResults.length,
    synthesis,
  });

  // Phase 10: Receipt + AP2 Chain Complete
  const hasPayments = providerResults.some(p => p.settlement.action === 'paid');
  mandates.complete(hasPayments ? 'success' : 'failure');

  events.emit('ap2:complete', 'mandate-tracking', {
    chainId: mandates.getChain().chainId,
    outcome: mandates.getChain().outcome,
    mandateCount: mandates.getChain().mandates.length,
  });

  const receipt = buildReceipt({
    query: config.query,
    startTime,
    encryptionDecision,
    strategyCommit,
    queryCommit,
    settlementsCommit,
    providers: providerResults,
    synthesis,
    mandateChain: mandates.getChain(),
  });

  const stats = biteLayers.getStats();
  const chain = mandates.getChain();
  console.log(`\n[Receipt] ${receipt.id}`);
  console.log(`  Duration: ${(receipt.duration / 1000).toFixed(1)}s`);
  console.log(`  BITE encryptions: ${stats.encryptions} (layers: ${stats.layers.join(', ')})`);
  console.log(`  AP2 mandates: ${chain.mandates.length} (${chain.outcome})`);
  console.log(`  Paid: $${receipt.totals.paid} | Refunded: $${receipt.totals.refunded}`);

  events.emit('agent:receipt', 'complete', { receipt });

  return receipt;
}
