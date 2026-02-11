// Provider Servers — Hono servers with optional x402 payment protection.
// Dispatches to config.handler() when present (Twinkle agents),
// otherwise falls back to built-in data aggregation.

import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import type { ProviderConfig } from './types.js';
import { V2_NETWORK, V2_USDC, FACILITATOR_URL } from './twinkle-config.js';

export interface RunningProvider {
  config: ProviderConfig;
  server: ServerType;
  url: string;
}

function createProviderApp(config: ProviderConfig): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ name: config.name, status: 'ok', price: config.price }));

  app.get('/query', async (c) => {
    const query = c.req.query('q') || 'Analyze';
    try {
      if (config.handler) {
        const result = await config.handler(query);
        return c.json(result);
      }
      return c.json({ provider: config.name, query, analysis: { summary: 'No handler', confidence: 0 }, timestamp: Date.now() });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}

async function createX402ProviderApp(config: ProviderConfig): Promise<Hono> {
  const { paymentMiddlewareFromConfig } = await import('@x402/hono');
  const { HTTPFacilitatorClient } = await import('@x402/core/server');
  const { ExactEvmScheme } = await import('@x402/evm/exact/server');

  const app = new Hono();
  const NETWORK = V2_NETWORK;
  const USDC = V2_USDC;

  const rawPrice = String(Math.round(parseFloat(config.price) * 1_000_000));

  const routes = {
    'GET /query': {
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: config.address,
        price: {
          amount: rawPrice,
          asset: USDC,
          extra: {
            name: 'USDC',
            version: '2',
          },
        },
        maxTimeoutSeconds: 300,
      },
      resource: `http://localhost:${config.port}/query`,
      description: `${config.name} provider`,
      mimeType: 'application/json',
    },
  };

  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
  const schemes = [{ network: NETWORK, server: new ExactEvmScheme() }];
  const middleware = paymentMiddlewareFromConfig(routes, facilitator, schemes);

  app.get('/health', (c) => c.json({ name: config.name, status: 'ok', price: config.price, x402: true }));

  app.get('/query', middleware, async (c) => {
    const query = c.req.query('q') || 'Analyze';
    try {
      if (config.handler) {
        const result = await config.handler(query);
        return c.json(result);
      }
      return c.json({ provider: config.name, query, analysis: { summary: 'No handler', confidence: 0 }, timestamp: Date.now() });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  return app;
}

export async function startProviders(
  configs: ProviderConfig[],
  options?: { useX402?: boolean },
): Promise<RunningProvider[]> {
  const running: RunningProvider[] = [];
  const useX402 = options?.useX402 ?? false;

  for (const config of configs) {
    const app = useX402
      ? await createX402ProviderApp(config)
      : createProviderApp(config);
    const server = serve({ fetch: app.fetch, port: config.port });
    running.push({
      config,
      server,
      url: `http://localhost:${config.port}`,
    });
    console.log(`  [Provider] ${config.name} on port ${config.port} ($${config.price})${useX402 ? ' [x402]' : ''}`);
  }

  return running;
}

export function stopProviders(providers: RunningProvider[]) {
  for (const p of providers) {
    p.server.close();
  }
}

export async function queryProvider(
  url: string,
  query: string,
  buyerPk?: string,
): Promise<any> {
  if (buyerPk) {
    const { purchaseFromX402Endpoint } = await import('./x402-client.js');
    const result = await purchaseFromX402Endpoint(`${url}/query`, query, buyerPk);
    return {
      ...result.data,
      _x402: { cost: result.paymentCost, used: result.x402Used },
    };
  }

  const resp = await fetch(`${url}/query?q=${encodeURIComponent(query)}`);
  if (!resp.ok) {
    throw new Error(`Provider returned ${resp.status}: ${await resp.text()}`);
  }
  return await resp.json();
}
