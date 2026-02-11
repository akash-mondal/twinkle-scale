// IP/Patent agents — PatentHawk (HIGH), PriorArt (MEDIUM), PatentLite (LOW)
import { callLLM } from '../openai-client.js';

// PatentHawk — GPT-5.2 with built-in web_search, HIGH quality
export async function patentHawk(query: string): Promise<any> {
  const result = await callLLM({
    instructions: `You are a patent research specialist. Search for prior art related to the query.

Use web search to find:
1. Relevant patents on patents.google.com
2. Academic papers on arxiv.org
3. Existing implementations or products

For each finding, provide:
- Title and source
- Similarity to the query (0-1 score)
- Key claims or innovations
- Publication date if available

Assess overall novelty of the concept described in the query.`,
    input: `Find prior art and assess patentability for: ${query}`,
    tools: [{ type: 'web_search' as any }],
    reasoning: 'high',
    jsonSchema: {
      name: 'patent_search',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          priorArt: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                source: { type: 'string' },
                similarity: { type: 'number' },
                keyClaims: { type: 'string' },
              },
              required: ['title', 'source', 'similarity', 'keyClaims'],
              additionalProperties: false,
            },
          },
          noveltyAssessment: { type: 'string' },
          patentabilityScore: { type: 'number' },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'priorArt', 'noveltyAssessment', 'patentabilityScore', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'PatentHawk',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.85, priorArt: [], noveltyAssessment: 'Needs review', patentabilityScore: 0.5, dataPoints: 5 },
    timestamp: Date.now(),
  };
}

// PriorArt — Web search with simpler instructions, MEDIUM quality
export async function priorArt(query: string): Promise<any> {
  const result = await callLLM({
    instructions: 'Search the web for existing work related to this concept. List 3-5 relevant findings with brief descriptions.',
    input: `Find prior art for: ${query}`,
    tools: [{ type: 'web_search' as any }],
    reasoning: 'low',
    jsonSchema: {
      name: 'prior_art_search',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          findings: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'findings', 'recommendation', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'PriorArt',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.55, findings: [], recommendation: 'Further research needed', dataPoints: 3 },
    timestamp: Date.now(),
  };
}

// PatentLite — NO LLM, basic fetch, LOW quality → designed to fail
export async function patentLite(query: string): Promise<any> {
  const searchUrl = `https://patents.google.com/?q=${encodeURIComponent(query)}&oq=${encodeURIComponent(query)}`;

  return {
    provider: 'PatentLite',
    query,
    analysis: {
      summary: `Basic patent search link generated for: ${query.slice(0, 50)}`,
      confidence: 0.20,
      link: searchUrl,
      findings: [`Search URL: ${searchUrl}`],
      recommendation: 'Manual search required.',
      dataPoints: 1,
    },
    timestamp: Date.now(),
  };
}
