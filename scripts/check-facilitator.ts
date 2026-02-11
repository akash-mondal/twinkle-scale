// Check x402 facilitator availability.
// Tries Kobaru first, then fallback facilitators.

import 'dotenv/config';

const FACILITATORS = [
  { name: 'Kobaru', url: 'https://gateway.kobaru.io' },
  { name: 'PayAI', url: 'https://facilitator.payai.network' },
];

async function checkFacilitator(name: string, url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/supported`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      console.log(`  ✓ ${name} (${url}) — OK`);
      console.log(`    Supported: ${JSON.stringify(data).slice(0, 200)}`);
      return true;
    }
    console.log(`  ✗ ${name} (${url}) — HTTP ${resp.status}`);
    return false;
  } catch (err: any) {
    console.log(`  ✗ ${name} (${url}) — ${err.message?.slice(0, 80)}`);
    return false;
  }
}

async function main() {
  console.log('[check-facilitator] Testing x402 facilitators...\n');

  for (const f of FACILITATORS) {
    const ok = await checkFacilitator(f.name, f.url);
    if (ok) {
      console.log(`\n  FACILITATOR_URL=${f.url}`);
      console.log('  X402_AVAILABLE=true');
      process.exit(0);
    }
  }

  console.log('\n  ⚠ No facilitator available.');
  console.log('  → Will use direct mode (useX402: false)');
  console.log('  X402_AVAILABLE=false');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
