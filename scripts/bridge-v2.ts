// Bridge USDC to BITE V2 Sandbox 2 chain.
// Tier 1: IMA bridge from Base Sepolia
// Tier 2: Check if USDC is mintable (test token)
// Tier 3: Deploy TwinkleTestToken as fallback

import 'dotenv/config';
import { ethers } from 'ethers';

const V2_RPC = process.env.RPC_URL || 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2';
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
const BUYER_PK = process.env.BUYER_PK!;
const V2_USDC = process.env.USDC_ADDRESS || '0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8';

// IMA bridge constants
const DEPOSIT_BOX = '0x6722D0f037A461a568155EA0490753E9C8825FC9';
const BASE_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const SCHAIN_NAME = 'bite-v2-sandbox-2';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address, uint256) returns (bool)',
  'function mint(address, uint256) returns (bool)',
  'function transfer(address, uint256) returns (bool)',
];

const DEPOSIT_BOX_ABI = [
  'function depositERC20(string schainName, address erc20, uint256 amount)',
];

async function checkBalance(provider: ethers.JsonRpcProvider, token: string, address: string): Promise<string> {
  const usdc = new ethers.Contract(token, ERC20_ABI, provider);
  const balance = await usdc.balanceOf(address);
  const decimals = await usdc.decimals();
  return ethers.formatUnits(balance, decimals);
}

async function tier1Bridge(amount: string): Promise<boolean> {
  console.log('\n[Tier 1] IMA Bridge — Base Sepolia → BITE V2 Sandbox 2');
  try {
    const baseSepolia = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);
    const wallet = new ethers.Wallet(BUYER_PK, baseSepolia);

    const balance = await checkBalance(baseSepolia, BASE_USDC, wallet.address);
    console.log(`  Base Sepolia USDC balance: $${balance}`);

    if (parseFloat(balance) < parseFloat(amount)) {
      console.log(`  Insufficient balance. Need $${amount}, have $${balance}`);
      return false;
    }

    // Approve
    const usdc = new ethers.Contract(BASE_USDC, ERC20_ABI, wallet);
    const rawAmount = ethers.parseUnits(amount, 6);

    console.log(`  Approving $${amount} USDC for DepositBox...`);
    const approveTx = await usdc.approve(DEPOSIT_BOX, rawAmount, { gasLimit: 100000 });
    await approveTx.wait();
    console.log(`  Approved: ${approveTx.hash}`);

    // Bridge
    const depositBox = new ethers.Contract(DEPOSIT_BOX, DEPOSIT_BOX_ABI, wallet);
    console.log(`  Bridging $${amount} USDC to ${SCHAIN_NAME}...`);
    const bridgeTx = await depositBox.depositERC20(SCHAIN_NAME, BASE_USDC, rawAmount, { gasLimit: 300000 });
    await bridgeTx.wait();
    console.log(`  Bridge tx: ${bridgeTx.hash}`);

    // Poll V2 chain for balance
    console.log('  Waiting for relay...');
    const v2Provider = new ethers.JsonRpcProvider(V2_RPC);
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const v2Balance = await checkBalance(v2Provider, V2_USDC, wallet.address);
      if (parseFloat(v2Balance) > 0) {
        console.log(`  ✓ Bridge complete! V2 USDC balance: $${v2Balance}`);
        return true;
      }
      process.stdout.write('.');
    }
    console.log('\n  Timeout waiting for bridge relay.');
    return false;
  } catch (err: any) {
    console.log(`  Bridge failed: ${err.message?.slice(0, 100)}`);
    return false;
  }
}

async function tier2Mint(amount: string): Promise<boolean> {
  console.log('\n[Tier 2] Check if V2 USDC is mintable (test token)');
  try {
    const v2Provider = new ethers.JsonRpcProvider(V2_RPC);
    const wallet = new ethers.Wallet(BUYER_PK, v2Provider);
    const usdc = new ethers.Contract(V2_USDC, ERC20_ABI, wallet) as ethers.Contract;

    const rawAmount = ethers.parseUnits(amount, 6);
    console.log(`  Attempting mint($${amount})...`);
    const tx = await (usdc as any).mint(wallet.address, rawAmount, { gasLimit: 200000 });
    await tx.wait();

    const balance = await checkBalance(v2Provider, V2_USDC, wallet.address);
    console.log(`  ✓ Mint successful! V2 USDC balance: $${balance}`);
    return true;
  } catch (err: any) {
    console.log(`  Mint not available: ${err.message?.slice(0, 80)}`);
    return false;
  }
}

async function tier3Deploy(): Promise<boolean> {
  console.log('\n[Tier 3] Deploy TwinkleTestToken');
  console.log('  TODO: Deploy mintable ERC20 with transferWithAuthorization');
  console.log('  This requires Foundry compilation. Skipping for now.');
  return false;
}

async function main() {
  if (!BUYER_PK) {
    console.error('FATAL: BUYER_PK not set');
    process.exit(1);
  }

  const v2Provider = new ethers.JsonRpcProvider(V2_RPC);
  const wallet = new ethers.Wallet(BUYER_PK, v2Provider);

  console.log('[bridge-v2] USDC Acquisition Strategy');
  console.log(`  Buyer: ${wallet.address}`);
  console.log(`  Target chain: ${V2_RPC.slice(-30)}`);
  console.log(`  Target USDC: ${V2_USDC}`);

  // Check existing balance
  const currentBalance = await checkBalance(v2Provider, V2_USDC, wallet.address);
  console.log(`  Current V2 USDC balance: $${currentBalance}`);

  if (parseFloat(currentBalance) >= 2.0) {
    console.log('\n  ✓ Sufficient balance. No bridging needed.');
    process.exit(0);
  }

  const neededAmount = '5.00';

  // Try each tier
  if (await tier1Bridge(neededAmount)) process.exit(0);
  if (await tier2Mint(neededAmount)) process.exit(0);
  if (await tier3Deploy()) process.exit(0);

  console.log('\n  ⚠ All tiers failed. Manual USDC acquisition needed.');
  process.exit(1);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
