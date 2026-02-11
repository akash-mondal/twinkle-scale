// LLM Brain — Encryption reasoning engine powered by OpenAI GPT-5.2.
// Uses Responses API with structured output for deterministic behavior.

import { callLLM } from './openai-client.js';
import type { EncryptionDecision, BiteLayer, AgentCategory } from './types.js';

export class AgentBrain {
  async analyzeEncryptionNeeds(query: string): Promise<EncryptionDecision> {
    const result = await callLLM({
      instructions: `You are an AI agent's security reasoning module. You decide which encryption layers to apply for a procurement query.

Available BITE encryption layers:
- "strategy": Encrypt the entire procurement plan before executing.
- "escrow": Encrypt escrow creation transactions.
- "query": Encrypt the query/request itself.
- "settlement": Encrypt all settlement decisions as a batch.

Be thorough — most procurement queries involving competitive intelligence or multi-provider coordination should use ALL layers.`,
      input: `Query: "${query}"\n\nAnalyze encryption needs for this procurement query.`,
      reasoning: 'medium',
      jsonSchema: {
        name: 'encryption_decision',
        schema: {
          type: 'object',
          properties: {
            layers: { type: 'array', items: { type: 'string', enum: ['strategy', 'escrow', 'query', 'settlement'] } },
            reasoning: { type: 'string' },
            threatModel: { type: 'array', items: { type: 'string' } },
            sensitivityLevel: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['layers', 'reasoning', 'threatModel', 'sensitivityLevel'],
          additionalProperties: false,
        },
        strict: true,
      },
    });

    const parsed = result.parsed || {};
    const layers = (parsed.layers || ['strategy', 'escrow', 'query', 'settlement']).filter(
      (l: string) => ['strategy', 'escrow', 'query', 'settlement'].includes(l),
    ) as BiteLayer[];

    return {
      layers: layers.length > 0 ? layers : ['strategy', 'escrow', 'query', 'settlement'],
      reasoning: parsed.reasoning || 'Full encryption applied for maximum privacy.',
      threatModel: parsed.threatModel || ['Strategy front-running', 'Provider collusion'],
      sensitivityLevel: parsed.sensitivityLevel || 'high',
    };
  }

  async selectProviders(
    available: Array<{ name: string; price: string; capabilities: string[]; reputation?: number }>,
    budget: string,
    query: string,
  ): Promise<Array<{ name: string; reason: string }>> {
    const result = await callLLM({
      instructions: `You are an AI procurement agent selecting providers for a query. Consider capabilities, price, and value for money.
Select ALL providers within budget — we want diverse perspectives. Budget: $${budget}.`,
      input: `Query: "${query}"\n\nAvailable providers:\n${available.map(p => `- ${p.name}: $${p.price}, capabilities: ${p.capabilities.join(', ')}`).join('\n')}`,
      reasoning: 'low',
      jsonSchema: {
        name: 'provider_selection',
        schema: {
          type: 'object',
          properties: {
            selected: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['name', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['selected'],
          additionalProperties: false,
        },
        strict: true,
      },
    });

    return result.parsed?.selected || available.map(p => ({ name: p.name, reason: 'Within budget' }));
  }

  async evaluateQuality(
    delivery: any,
    providerName: string,
    threshold: number,
  ): Promise<{ score: number; passed: boolean; reasoning: string }> {
    return this.evaluateQualityForCategory(delivery, providerName, threshold);
  }

  async evaluateQualityForCategory(
    delivery: any,
    providerName: string,
    threshold: number,
    category?: AgentCategory,
  ): Promise<{ score: number; passed: boolean; reasoning: string }> {
    const categoryPrompts: Record<string, string> = {
      'code-audit': 'Focus on: vulnerability severity, coverage of OWASP top 10, line-level references, fix quality.',
      'legal-review': 'Focus on: clause coverage, risk identification, jurisdictional awareness, actionability.',
      'ip-patent': 'Focus on: prior art relevance, patent number accuracy, novelty assessment depth.',
      'defi-strategy': 'Focus on: data source diversity, risk quantification, actionable allocations, rebalance triggers.',
    };

    const categoryHint = category ? categoryPrompts[category] || '' : '';

    const result = await callLLM({
      instructions: `You are a quality evaluation module. Score a provider's delivery on a 0-10 scale.

Scoring criteria:
- Confidence level (0-1) → multiply by 10 for base score
- Data points used → add 1 per data point (max +5)
- Analysis depth → deduct for shallow/generic responses
- Actionable recommendations → bonus for specific advice

Quality threshold: ${threshold}/10. Below = refund, above = payment.
${categoryHint}`,
      input: `Provider: ${providerName}\nDelivery:\n${JSON.stringify(delivery, null, 2)}`,
      reasoning: 'medium',
      jsonSchema: {
        name: 'quality_evaluation',
        schema: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            passed: { type: 'boolean' },
            reasoning: { type: 'string' },
          },
          required: ['score', 'passed', 'reasoning'],
          additionalProperties: false,
        },
        strict: true,
      },
    });

    const parsed = result.parsed || {};
    const score = typeof parsed.score === 'number' ? Math.min(10, Math.max(0, parsed.score)) : 5;
    return {
      score,
      passed: score >= threshold,
      reasoning: parsed.reasoning || `Score: ${score}/${threshold}`,
    };
  }

  async synthesize(
    results: Array<{ name: string; analysis: any }>,
    query: string,
  ): Promise<string> {
    const result = await callLLM({
      instructions: `You are synthesizing intelligence from ${results.length} specialist agents. Provide a unified institutional-grade analysis.`,
      input: `Query: "${query}"\n\nSpecialist reports:\n${results.map(r => `[${r.name}] ${r.analysis?.summary || JSON.stringify(r.analysis)}`).join('\n\n')}`,
      reasoning: 'high',
      jsonSchema: {
        name: 'synthesis',
        schema: {
          type: 'object',
          properties: {
            synthesis: { type: 'string' },
            consensus: { type: 'string' },
            confidence: { type: 'number' },
            keyInsights: { type: 'array', items: { type: 'string' } },
          },
          required: ['synthesis', 'consensus', 'confidence', 'keyInsights'],
          additionalProperties: false,
        },
        strict: true,
      },
    });

    return result.parsed?.synthesis || 'Analysis synthesis completed.';
  }
}
