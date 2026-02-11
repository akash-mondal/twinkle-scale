import { serve } from '@hono/node-server';
import { createApp } from './app.js';

// Import env validation (crashes on missing required vars)
import { env } from '../env.js';

const app = createApp({
  rpcUrl: env.RPC_URL,
  buyerPk: env.BUYER_PK,
  buyerAddress: env.BUYER_ADDRESS,
  openaiApiKey: env.OPENAI_API_KEY,
  token: env.USDC_ADDRESS,
  corsOrigins: env.CORS_ORIGINS,
  wallets: {
    pk1: env.PROVIDER1_PK,
    addr1: env.PROVIDER1_ADDRESS,
    pk2: env.PROVIDER2_PK,
    addr2: env.PROVIDER2_ADDRESS,
    pk3: env.PROVIDER3_PK,
    addr3: env.PROVIDER3_ADDRESS,
  },
});

const server = serve({
  fetch: app.fetch,
  port: env.API_PORT,
});

console.log(`\n[twinkle-api] Server running on http://localhost:${env.API_PORT}`);
console.log(`[twinkle-api] Health: http://localhost:${env.API_PORT}/api/health`);
console.log(`[twinkle-api] Agents: http://localhost:${env.API_PORT}/api/agents`);

// Graceful shutdown
function shutdown() {
  console.log('\n[twinkle-api] Shutting down...');
  server.close(() => {
    console.log('[twinkle-api] Server closed.');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
