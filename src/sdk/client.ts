// TwinkleClient — The unified SDK entry point for encrypted agent commerce

import { ethers } from 'ethers';
import { BITE_V2_SANDBOX } from './config.js';
import { BiteModule } from './bite.js';
import { EscrowModule } from './escrow.js';
import { IdentityModule } from './identity.js';
import { ReputationModule } from './reputation.js';
import type { TwinkleClientConfig } from './types.js';

export class TwinkleClient {
  readonly provider: ethers.JsonRpcProvider;
  readonly signer: ethers.Wallet;
  readonly bite: BiteModule;
  readonly escrow: EscrowModule;
  readonly identity: IdentityModule;
  readonly reputation: ReputationModule;

  constructor(config: TwinkleClientConfig) {
    const rpcUrl = config.rpcUrl || BITE_V2_SANDBOX.rpcUrl;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new ethers.Wallet(config.privateKey, this.provider);

    this.bite = new BiteModule(rpcUrl, this.signer);
    this.escrow = new EscrowModule(
      this.provider,
      this.signer,
      this.bite,
      config.contracts?.escrowV2,
    );
    this.identity = new IdentityModule(
      this.provider,
      this.signer,
      config.contracts?.identityRegistry,
    );
    this.reputation = new ReputationModule(
      this.provider,
      this.signer,
      config.contracts?.reputationRegistry,
    );
  }

  get address(): string {
    return this.signer.address;
  }

  async getUsdcBalance(tokenAddress?: string): Promise<bigint> {
    const token = tokenAddress || '0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8';
    const contract = new ethers.Contract(token, ['function balanceOf(address) view returns (uint256)'], this.provider);
    return await contract.balanceOf(this.signer.address);
  }

  async transferUsdc(to: string, amount: bigint, tokenAddress?: string): Promise<string> {
    const token = tokenAddress || '0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8';
    const contract = new ethers.Contract(token, ['function transfer(address, uint256) returns (bool)'], this.signer);
    const tx = await contract.transfer(to, amount, { type: 0, gasLimit: 100000 });
    const receipt = await tx.wait();
    return receipt!.hash;
  }

  static hash(data: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(data));
  }

  static parseUsdc(amount: string | number): bigint {
    return ethers.parseUnits(String(amount), 6);
  }

  static formatUsdc(amount: bigint): string {
    return ethers.formatUnits(amount, 6);
  }
}
