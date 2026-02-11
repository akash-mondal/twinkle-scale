// Deploy contracts to BITE V2 Sandbox 2 using Pixie-lab Foundry artifacts.
// The contracts are the same Solidity — just deploying on the new chain.

import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const RPC = process.env.RPC_URL!;
const PK = process.env.BUYER_PK!;
const USDC = process.env.USDC_ADDRESS!;

// Use Pixie-lab artifacts (same Solidity contracts)
const PIXIE_ARTIFACTS = resolve('/Users/akshmnd/Dev Projects/Pixie/pixie-lab/contracts/out');

function loadArtifact(name: string): { abi: any[]; bytecode: string } {
  const path = resolve(PIXIE_ARTIFACTS, `${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Artifact not found: ${path}`);
  }
  const artifact = JSON.parse(readFileSync(path, 'utf-8'));
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

async function deploy(wallet: ethers.Wallet, name: string, args: any[] = []): Promise<string> {
  console.log(`  Deploying ${name}(${args.map(String).join(', ')})...`);
  const { abi, bytecode } = loadArtifact(name);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args, { gasLimit: 5_000_000, type: 0 });
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ✓ ${name}: ${address}`);
  return address;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);

  console.log('═══════════════════════════════════════════════════');
  console.log('  TWINKLE — Contract Deployment to BITE V2');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Chain: ${(await provider.getNetwork()).chainId}`);
  console.log(`  Block: ${await provider.getBlockNumber()}`);
  console.log(`  Deployer: ${wallet.address}`);
  console.log(`  sFUEL: ${ethers.formatEther(await provider.getBalance(wallet.address))}`);
  console.log('');

  // Deploy all 3 contracts
  const escrowAddr = await deploy(wallet, 'PixieEscrowV2', [ethers.parseUnits('10000', 6)]);
  const identityAddr = await deploy(wallet, 'PixieIdentityRegistry', []);
  const reputationAddr = await deploy(wallet, 'PixieReputationRegistry', [identityAddr]);

  // Configure escrow
  console.log('\n  Configuring escrow...');
  const { abi } = loadArtifact('PixieEscrowV2');
  const escrow = new ethers.Contract(escrowAddr, abi, wallet);

  const tx1 = await (escrow as any).setAllowedToken(USDC, true, { gasLimit: 200000, type: 0 });
  await tx1.wait();
  console.log(`  ✓ Allowed USDC: ${USDC}`);

  const tx2 = await (escrow as any).setMaxEscrowAmount(ethers.parseUnits('10000', 6), { gasLimit: 200000, type: 0 });
  await tx2.wait();
  console.log('  ✓ Max escrow: 10,000 USDC');

  // Update .env file
  const envPath = resolve(process.cwd(), '.env');
  let env = readFileSync(envPath, 'utf-8');
  env = env.replace(/^ESCROW_ADDRESS=.*$/m, `ESCROW_ADDRESS=${escrowAddr}`);
  env = env.replace(/^IDENTITY_ADDRESS=.*$/m, `IDENTITY_ADDRESS=${identityAddr}`);
  env = env.replace(/^REPUTATION_ADDRESS=.*$/m, `REPUTATION_ADDRESS=${reputationAddr}`);
  writeFileSync(envPath, env);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  DEPLOYED (updated .env):');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ESCROW_ADDRESS=${escrowAddr}`);
  console.log(`  IDENTITY_ADDRESS=${identityAddr}`);
  console.log(`  REPUTATION_ADDRESS=${reputationAddr}`);
  console.log(`  USDC_ADDRESS=${USDC}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
