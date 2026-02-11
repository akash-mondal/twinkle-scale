// Check if BITE V2 precompile is accessible on the target chain.
// Calls getRandomWalletForCTX() at the precompile address.

import 'dotenv/config';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2';
const PRECOMPILE = '0x0000000000000000000000000000000000000100';

async function main() {
  console.log('[check-v2-precompile] Probing BITE V2 precompile...');
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  Precompile: ${PRECOMPILE}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Check if the precompile has code
  const code = await provider.getCode(PRECOMPILE);
  console.log(`  Code at precompile: ${code.length > 2 ? `${code.length} bytes` : 'EMPTY'}`);

  if (code.length <= 2) {
    console.log('\n  ⚠ BITE V2 precompile NOT available on this chain.');
    console.log('  → Will use V1 fallback (commitEncrypted + verifyAndSettle)');
    console.log('\n  BITE_V2_AVAILABLE=false');
    process.exit(0);
  }

  // Try calling getRandomWalletForCTX()
  try {
    const iface = new ethers.Interface(['function getRandomWalletForCTX() view returns (address)']);
    const calldata = iface.encodeFunctionData('getRandomWalletForCTX');
    const result = await provider.call({ to: PRECOMPILE, data: calldata });
    const [wallet] = iface.decodeFunctionResult('getRandomWalletForCTX', result);
    console.log(`  getRandomWalletForCTX() returned: ${wallet}`);
    console.log('\n  ✓ BITE V2 precompile IS available!');
    console.log('  BITE_V2_AVAILABLE=true');
  } catch (err: any) {
    console.log(`  getRandomWalletForCTX() failed: ${err.message?.slice(0, 100)}`);
    console.log('\n  ⚠ Precompile has code but V2 functions not working.');
    console.log('  → Will use V1 fallback');
    console.log('  BITE_V2_AVAILABLE=false');
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
