// Legal Review agents — LexGuard (HIGH), ContractEye (LOW)
import { callLLM } from '../openai-client.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_TOS = readFileSync(resolve(__dirname, '../../data/sample-tos.txt'), 'utf-8');

// LexGuard — DeFi legal analyst, HIGH quality
export async function lexGuard(query: string): Promise<any> {
  const result = await callLLM({
    instructions: `You are a DeFi legal analyst specializing in smart contract terms of service and regulatory compliance.

Analyze the provided terms clause-by-clause. For each section evaluate:
- Liability exposure for the user
- Modification/termination risks
- Dispute resolution adequacy
- Data privacy compliance
- Consumer protection red flags
- Jurisdictional concerns

Rate each section's risk level and provide actionable recommendations.`,
    input: `Review these Terms of Service for legal risks:\n\n${SAMPLE_TOS}\n\nUser query: ${query}`,
    reasoning: 'high',
    jsonSchema: {
      name: 'legal_review',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          overallRisk: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                section: { type: 'string' },
                risk: { type: 'string' },
                issue: { type: 'string' },
                recommendation: { type: 'string' },
              },
              required: ['section', 'risk', 'issue', 'recommendation'],
              additionalProperties: false,
            },
          },
          redFlags: { type: 'array', items: { type: 'string' } },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'overallRisk', 'sections', 'redFlags', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'LexGuard',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.85, overallRisk: 'high', sections: [], redFlags: [], dataPoints: 6 },
    timestamp: Date.now(),
  };
}

// ContractEye — Generic summary, LOW quality → designed to fail
export async function contractEye(query: string): Promise<any> {
  const result = await callLLM({
    instructions: 'Summarize these terms in exactly 2 sentences. Nothing else.',
    input: SAMPLE_TOS,
    reasoning: 'none',
  });

  return {
    provider: 'ContractEye',
    query,
    analysis: {
      summary: result.text.slice(0, 200),
      confidence: 0.35,
      overallRisk: 'unknown',
      sections: [],
      redFlags: [],
      dataPoints: 1,
    },
    timestamp: Date.now(),
  };
}
