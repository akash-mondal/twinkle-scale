// DeFi Strategy agents — YieldSage (HIGH), AlphaQuick (MEDIUM)
import { callLLM } from '../openai-client.js';

const CG_URL = 'https://api.coingecko.com/api/v3';
const DEFILLAMA_URL = 'https://api.llama.fi';
const PYTH_URL = 'https://hermes.pyth.network/v2/updates/price/latest';
const SOL_PYTH_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

async function fetchPyth(): Promise<any> {
  try {
    const resp = await fetch(`${PYTH_URL}?ids[]=${SOL_PYTH_ID}`);
    const data = await resp.json();
    const p = data.parsed?.[0]?.price;
    if (!p) return { price: 0, confidence: 0 };
    return { price: Number(p.price) * Math.pow(10, Number(p.expo)), confidence: Number(p.conf) * Math.pow(10, Number(p.expo)) };
  } catch { return { price: 0, confidence: 0 }; }
}

async function fetchCoinGecko(): Promise<any> {
  try {
    const resp = await fetch(`${CG_URL}/simple/price?ids=solana&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`);
    const data = await resp.json();
    return data.solana || { usd: 0 };
  } catch { return { usd: 0 }; }
}

async function fetchDeFiLlama(): Promise<any> {
  try {
    const resp = await fetch(`${DEFILLAMA_URL}/v2/chains`);
    const data = await resp.json();
    const sol = data.find((c: any) => c.name === 'Solana');
    return { tvl: sol?.tvl || 0, change24h: sol?.change_1d || 0 };
  } catch { return { tvl: 0, change24h: 0 }; }
}

// YieldSage — Multi-source data + GPT-5.2 analysis, HIGH quality
export async function yieldSage(query: string): Promise<any> {
  const [pyth, cg, defi] = await Promise.allSettled([fetchPyth(), fetchCoinGecko(), fetchDeFiLlama()]);
  const pythData = pyth.status === 'fulfilled' ? pyth.value : { price: 0 };
  const cgData = cg.status === 'fulfilled' ? cg.value : { usd: 0 };
  const defiData = defi.status === 'fulfilled' ? defi.value : { tvl: 0, change24h: 0 };

  const dataContext = `Live market data:
- Pyth Oracle: SOL = $${pythData.price.toFixed(2)} (confidence: ±$${pythData.confidence.toFixed(4)})
- CoinGecko: SOL = $${cgData.usd}, 24h volume: $${((cgData.usd_24h_vol || 0) / 1e6).toFixed(0)}M, 24h change: ${(cgData.usd_24h_change || 0).toFixed(2)}%
- DeFiLlama: Solana TVL = $${(defiData.tvl / 1e9).toFixed(2)}B, 24h change: ${defiData.change24h.toFixed(2)}%`;

  const result = await callLLM({
    instructions: `You are an institutional DeFi strategist. Analyze the provided market data and create a comprehensive allocation strategy.

Include:
- Protocol allocation recommendations (% breakdown)
- Risk tier classification for each allocation
- Rebalance triggers
- Entry/exit signals
- Risk-adjusted expected yield`,
    input: `${dataContext}\n\nQuery: ${query}`,
    reasoning: 'high',
    jsonSchema: {
      name: 'defi_strategy',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          trend: { type: 'string' },
          allocations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                protocol: { type: 'string' },
                allocation: { type: 'number' },
                riskTier: { type: 'string' },
                expectedYield: { type: 'string' },
              },
              required: ['protocol', 'allocation', 'riskTier', 'expectedYield'],
              additionalProperties: false,
            },
          },
          rebalanceTriggers: { type: 'array', items: { type: 'string' } },
          riskLevel: { type: 'string' },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'trend', 'allocations', 'rebalanceTriggers', 'riskLevel', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'YieldSage',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.85, trend: 'neutral', allocations: [], rebalanceTriggers: [], riskLevel: 'medium', dataPoints: 6 },
    timestamp: Date.now(),
  };
}

// AlphaQuick — CoinGecko only + GPT-5.2, MEDIUM quality
export async function alphaQuick(query: string): Promise<any> {
  const cg = await fetchCoinGecko();

  const result = await callLLM({
    instructions: 'You are a quick DeFi advisor. Give brief, actionable advice based on the market data. Keep it concise.',
    input: `SOL: $${cg.usd}, 24h change: ${(cg.usd_24h_change || 0).toFixed(2)}%, volume: $${((cg.usd_24h_vol || 0) / 1e6).toFixed(0)}M\n\nQuery: ${query}`,
    reasoning: 'low',
    jsonSchema: {
      name: 'quick_advice',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          confidence: { type: 'number' },
          recommendation: { type: 'string' },
          trend: { type: 'string' },
          dataPoints: { type: 'number' },
        },
        required: ['summary', 'confidence', 'recommendation', 'trend', 'dataPoints'],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  return {
    provider: 'AlphaQuick',
    query,
    analysis: result.parsed || { summary: result.text, confidence: 0.55, recommendation: 'Hold', trend: 'neutral', dataPoints: 2 },
    timestamp: Date.now(),
  };
}
