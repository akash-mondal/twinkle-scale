// defineAgent — zero-boilerplate agent creation with x402 payment protection.
// Parameterized for any SKALE chain via optional chainConfig.

import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { V2_NETWORK, V2_USDC, FACILITATOR_URL } from './twinkle-config.js';

export interface AgentDefinition {
  name: string;
  description?: string;
  port: number;
  price: string;
  privateKey: string;
  address: string;
  dataSources?: string[];
  handler: (query: string) => Promise<any>;
  chainConfig?: {
    network: `eip155:${string}`;
    usdc: string;
    facilitator: string;
  };
}

export interface RunningAgent {
  name: string;
  port: number;
  url: string;
  server: ServerType;
  stop: () => void;
}

export async function startAgent(def: AgentDefinition): Promise<RunningAgent> {
  const { paymentMiddlewareFromConfig } = await import('@x402/hono');
  const { HTTPFacilitatorClient } = await import('@x402/core/server');
  const { ExactEvmScheme } = await import('@x402/evm/exact/server');

  const app = new Hono();
  const NETWORK = def.chainConfig?.network || V2_NETWORK;
  const USDC = def.chainConfig?.usdc || V2_USDC;
  const FACILITATOR = def.chainConfig?.facilitator || FACILITATOR_URL;

  const rawPrice = String(Math.round(parseFloat(def.price) * 1_000_000));

  const routes = {
    'GET /query': {
      accepts: {
        scheme: 'exact',
        network: NETWORK,
        payTo: def.address,
        price: {
          amount: rawPrice,
          asset: USDC,
          extra: { name: 'USDC', version: '2' },
        },
        maxTimeoutSeconds: 300,
      },
      resource: `http://localhost:${def.port}/query`,
      description: `${def.name}${def.description ? ' — ' + def.description : ''}`,
      mimeType: 'application/json',
    },
  };

  const facilitator = new HTTPFacilitatorClient({ url: FACILITATOR });
  const schemes = [{ network: NETWORK, server: new ExactEvmScheme() }];
  const middleware = paymentMiddlewareFromConfig(routes, facilitator, schemes);

  app.get('/health', (c) => c.json({
    name: def.name,
    status: 'ok',
    price: def.price,
    x402: true,
  }));

  app.get('/query', middleware, async (c) => {
    const query = c.req.query('q') || '';
    const result = await def.handler(query);
    return c.json(result);
  });

  const server = serve({ fetch: app.fetch, port: def.port });

  return {
    name: def.name,
    port: def.port,
    url: `http://localhost:${def.port}`,
    server,
    stop: () => server.close(),
  };
}

export async function startAgents(defs: AgentDefinition[]): Promise<RunningAgent[]> {
  const agents: RunningAgent[] = [];
  for (const def of defs) {
    agents.push(await startAgent(def));
  }
  return agents;
}
