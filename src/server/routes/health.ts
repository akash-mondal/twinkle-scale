import { Hono } from 'hono';
import { ethers } from 'ethers';

export function healthRoutes(rpcUrl: string): Hono {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    let chainStatus = 'disconnected';
    let blockNumber = 0;

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      blockNumber = await provider.getBlockNumber();
      chainStatus = 'connected';
    } catch {}

    return c.json({
      status: 'ok',
      uptime: process.uptime(),
      chain: chainStatus,
      blockNumber,
      timestamp: Date.now(),
    });
  });

  return app;
}
