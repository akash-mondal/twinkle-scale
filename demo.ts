// Twinkle Demo — runs all 4 acts, prints narrative, saves receipt.

import 'dotenv/config';
import { initClient } from './src/openai-client.js';
import { configure } from './src/twinkle-config.js';
import { runMarketplace } from './src/marketplace.js';
import { writeFileSync } from 'fs';

async function main() {
  const rpcUrl = process.env.RPC_URL!;
  const buyerPk = process.env.BUYER_PK!;
  const openaiKey = process.env.OPENAI_API_KEY!;
  const token = process.env.USDC_ADDRESS!;

  if (!rpcUrl || !buyerPk || !openaiKey || !token) {
    console.error('Missing required env vars. Copy .env.example to .env and fill in values.');
    process.exit(1);
  }

  // Initialize OpenAI client
  initClient(openaiKey, process.env.OPENAI_MODEL);

  // Configure chain
  configure({
    escrow: process.env.ESCROW_ADDRESS,
    identity: process.env.IDENTITY_ADDRESS,
    reputation: process.env.REPUTATION_ADDRESS,
    usdc: token,
  });

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   ✦ TWINKLE — Encrypted Agent Marketplace on SKALE ✦     ║');
  console.log('║                                                           ║');
  console.log('║   BITE V2 + x402 + AP2 + ERC-8004 + Escrow               ║');
  console.log('║   "From code to confidence"                               ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const receipt = await runMarketplace({
    acts: [],
    rpcUrl,
    buyerPk,
    openaiApiKey: openaiKey,
    token,
    qualityThreshold: 5,
    useX402: process.env.USE_X402 === 'true',
    wallets: {
      pk1: process.env.PROVIDER1_PK!,
      addr1: process.env.PROVIDER1_ADDRESS!,
      pk2: process.env.PROVIDER2_PK!,
      addr2: process.env.PROVIDER2_ADDRESS!,
      pk3: process.env.PROVIDER3_PK!,
      addr3: process.env.PROVIDER3_ADDRESS!,
    },
    onEvent: (e) => {
      // Log key events for demo visibility
      if (['bite:committed', 'escrow:settled', 'x402:payment', 'ap2:complete'].includes(e.type)) {
        console.log(`  [${e.type}] ${JSON.stringify(e.data).slice(0, 120)}`);
      }
    },
  });

  // Save receipt
  const receiptPath = `receipt-${Date.now()}.json`;
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(`\n  Receipt saved: ${receiptPath}`);
}

main().catch(err => {
  console.error('\nDemo failed:', err.message);
  process.exit(1);
});
