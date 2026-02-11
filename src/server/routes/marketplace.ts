import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { runMarketplace } from '../../marketplace.js';
import { initClient } from '../../openai-client.js';
import type { MarketplaceReceipt, AgentEvent } from '../../types.js';

// In-memory storage (acceptable for hackathon)
const runs = new Map<string, MarketplaceReceipt>();
const activeStreams = new Map<string, AgentEvent[]>();

export function marketplaceRoutes(config: {
  rpcUrl: string;
  buyerPk: string;
  openaiApiKey: string;
  token: string;
  wallets: { pk1: string; addr1: string; pk2: string; addr2: string; pk3: string; addr3: string };
}): Hono {
  const app = new Hono();

  app.post('/api/marketplace/run', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const budget = body.budget || '0.50';
    const useX402 = body.useX402 ?? false;
    const qualityThreshold = body.qualityThreshold ?? 5;

    const runId = `run_${Date.now()}`;
    activeStreams.set(runId, []);

    // Initialize OpenAI
    initClient(config.openaiApiKey);

    // Run in background
    runMarketplace({
      acts: [],
      rpcUrl: config.rpcUrl,
      buyerPk: config.buyerPk,
      openaiApiKey: config.openaiApiKey,
      token: config.token,
      qualityThreshold,
      useX402,
      wallets: config.wallets,
      onEvent: (event) => {
        const events = activeStreams.get(runId);
        if (events) events.push(event);
      },
    }).then(receipt => {
      runs.set(runId, receipt);
      runs.set(receipt.id, receipt);
    }).catch(err => {
      console.error(`[marketplace] Run ${runId} failed:`, err.message);
    });

    return c.json({ runId, status: 'started' });
  });

  app.get('/api/marketplace/events', (c) => {
    const runId = c.req.query('runId');
    if (!runId) return c.json({ error: 'Missing runId query parameter' }, 400);

    return streamSSE(c, async (stream) => {
      let lastIndex = 0;
      const maxWait = 300_000; // 5 minutes max
      const startTime = Date.now();

      while (Date.now() - startTime < maxWait) {
        const events = activeStreams.get(runId);
        if (!events) break;

        while (lastIndex < events.length) {
          const event = events[lastIndex++];
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }

        // Check if run completed
        if (runs.has(runId)) {
          await stream.writeSSE({
            event: 'marketplace:complete',
            data: JSON.stringify({ runId, receiptId: runs.get(runId)!.id }),
          });
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      }

      activeStreams.delete(runId);
    });
  });

  app.get('/api/marketplace/receipt/:id', (c) => {
    const id = c.req.param('id');
    const receipt = runs.get(id);
    if (!receipt) return c.json({ error: 'Receipt not found' }, 404);
    return c.json(receipt);
  });

  app.get('/api/marketplace/history', (c) => {
    const history = [...runs.entries()]
      .filter(([key]) => key.startsWith('run_'))
      .map(([runId, receipt]) => ({
        runId,
        receiptId: receipt.id,
        timestamp: receipt.timestamp,
        duration: receipt.duration,
        acts: receipt.acts.length,
        totals: receipt.totals,
      }));
    return c.json({ runs: history, count: history.length });
  });

  return app;
}
