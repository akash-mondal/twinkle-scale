import { Hono } from 'hono';
import { logger } from './middleware/logger.js';
import { createCors } from './middleware/cors.js';
import { errorHandler } from './middleware/error.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { walletRoutes } from './routes/wallet.js';

export interface AppConfig {
  rpcUrl: string;
  buyerPk: string;
  buyerAddress: string;
  openaiApiKey: string;
  token: string;
  corsOrigins: string[];
  wallets: { pk1: string; addr1: string; pk2: string; addr2: string; pk3: string; addr3: string };
}

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  // Middleware
  app.use('*', logger);
  app.use('*', createCors(config.corsOrigins));
  app.onError(errorHandler);

  // Routes
  app.route('/', healthRoutes(config.rpcUrl));
  app.route('/', agentRoutes());
  app.route('/', marketplaceRoutes({
    rpcUrl: config.rpcUrl,
    buyerPk: config.buyerPk,
    openaiApiKey: config.openaiApiKey,
    token: config.token,
    wallets: config.wallets,
  }));
  app.route('/', walletRoutes(config.rpcUrl, config.buyerAddress, config.token));

  return app;
}
