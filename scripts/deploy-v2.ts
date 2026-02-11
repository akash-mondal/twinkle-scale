// Deploy TwinkleEscrowV2 + IdentityRegistry + ReputationRegistry to BITE V2 chain.
// Uses pre-compiled Foundry artifacts from contracts/out.

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const V2_RPC = process.env.RPC_URL || 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2';
const BUYER_PK = process.env.BUYER_PK!;
const V2_USDC = process.env.USDC_ADDRESS || '0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8';

// Paths to Foundry artifacts — local to this repo
const ARTIFACTS_DIR = resolve(process.cwd(), 'contracts/out');

function loadArtifact(name: string): { abi: any[]; bytecode: string } {
  const path = resolve(ARTIFACTS_DIR, `${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Artifact not found: ${path}. Run 'forge build' in contracts/ first.`);
  }
  const artifact = JSON.parse(readFileSync(path, 'utf-8'));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function deploy(wallet: ethers.Wallet, name: string, args: any[] = []): Promise<string> {
  console.log(`  Deploying ${name}...`);
  const { abi, bytecode } = loadArtifact(name);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args, { gasLimit: 5000000 }) as ethers.BaseContract;
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ✓ ${name}: ${address}`);
  return address;
}

async function main() {
  if (!BUYER_PK) {
    console.error('FATAL: BUYER_PK not set');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(V2_RPC);
  const wallet = new ethers.Wallet(BUYER_PK, provider);

  console.log('[deploy-v2] Deploying contracts to BITE V2 Sandbox 2');
  console.log(`  Deployer: ${wallet.address}`);
  console.log(`  Chain RPC: ${V2_RPC.slice(-30)}`);
  console.log(`  Artifacts: ${ARTIFACTS_DIR}`);

  // Check block number to verify connectivity
  const block = await provider.getBlockNumber();
  console.log(`  Chain block: ${block}\n`);

  // Deploy contracts
  const escrowAddr = await deploy(wallet, 'TwinkleEscrowV2');
  const identityAddr = await deploy(wallet, 'TwinkleIdentityRegistry');
  const reputationAddr = await deploy(wallet, 'TwinkleReputationRegistry');

  // Configure escrow
  console.log('\n  Configuring escrow guardrails...');
  const { abi } = loadArtifact('TwinkleEscrowV2');
  const escrow = new ethers.Contract(escrowAddr, abi, wallet) as ethers.Contract;

  const tx1 = await (escrow as any).setAllowedToken(V2_USDC, true, { gasLimit: 200000 });
  await tx1.wait();
  console.log(`  ✓ Allowed token: ${V2_USDC}`);

  const tx2 = await (escrow as any).setMaxEscrowAmount(ethers.parseUnits('1000', 6), { gasLimit: 200000 });
  await tx2.wait();
  console.log('  ✓ Max escrow: 1000 USDC');

  console.log('\n═══════════════════════════════════════');
  console.log('  DEPLOYED CONTRACTS (add to .env):');
  console.log('═══════════════════════════════════════');
  console.log(`  ESCROW_ADDRESS=${escrowAddr}`);
  console.log(`  IDENTITY_ADDRESS=${identityAddr}`);
  console.log(`  REPUTATION_ADDRESS=${reputationAddr}`);
  console.log(`  USDC_ADDRESS=${V2_USDC}`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
