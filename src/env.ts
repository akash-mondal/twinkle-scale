import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`FATAL: Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function optional(name: string, defaultVal: string): string {
  return process.env[name] || defaultVal;
}

export const env = {
  // Chain
  RPC_URL: required('RPC_URL'),
  CHAIN_ID: required('CHAIN_ID'),

  // Wallets
  BUYER_PK: required('BUYER_PK'),
  BUYER_ADDRESS: required('BUYER_ADDRESS'),
  PROVIDER1_PK: required('PROVIDER1_PK'),
  PROVIDER1_ADDRESS: required('PROVIDER1_ADDRESS'),
  PROVIDER2_PK: required('PROVIDER2_PK'),
  PROVIDER2_ADDRESS: required('PROVIDER2_ADDRESS'),
  PROVIDER3_PK: required('PROVIDER3_PK'),
  PROVIDER3_ADDRESS: required('PROVIDER3_ADDRESS'),

  // LLM
  OPENAI_API_KEY: required('OPENAI_API_KEY'),
  OPENAI_MODEL: optional('OPENAI_MODEL', 'gpt-5.2'),

  // Contracts
  USDC_ADDRESS: required('USDC_ADDRESS'),
  ESCROW_ADDRESS: required('ESCROW_ADDRESS'),
  IDENTITY_ADDRESS: required('IDENTITY_ADDRESS'),
  REPUTATION_ADDRESS: required('REPUTATION_ADDRESS'),

  // x402
  FACILITATOR_URL: optional('FACILITATOR_URL', 'https://gateway.kobaru.io'),
  X402_NETWORK: optional('X402_NETWORK', 'eip155:103698795'),

  // Server
  API_PORT: parseInt(optional('API_PORT', '3001')),
  CORS_ORIGINS: optional('CORS_ORIGINS', 'http://localhost:5173,http://localhost:3000').split(','),
  JWT_SECRET: optional('JWT_SECRET', ''),
  LOG_LEVEL: optional('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',

  // Bridge
  BASE_SEPOLIA_RPC: optional('BASE_SEPOLIA_RPC', 'https://sepolia.base.org'),
} as const;

// Warn about auto-generated JWT secret
if (!process.env.JWT_SECRET) {
  console.warn('[env] WARNING: JWT_SECRET not set — using auto-generated secret (not suitable for multi-instance deployment)');
  (env as any).JWT_SECRET = `auto_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

console.log(`[env] Chain: ${env.CHAIN_ID} | RPC: ${env.RPC_URL.slice(0, 50)}...`);
console.log(`[env] Model: ${env.OPENAI_MODEL} | Port: ${env.API_PORT}`);
