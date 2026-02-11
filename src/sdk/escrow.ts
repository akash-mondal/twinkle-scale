// Escrow module — conditional payments with BITE encryption

import { ethers } from 'ethers';
import { CONTRACTS, ESCROW_V2_ABI, ERC20_ABI } from './config.js';
import { BiteModule } from './bite.js';
import type { CreateEscrowParams, EscrowData, EscrowStatus, BiteEncryptResult } from './types.js';

export class EscrowModule {
  private contract: ethers.Contract;
  private contractAddress: string;

  constructor(
    private provider: ethers.JsonRpcProvider,
    private signer: ethers.Wallet,
    private bite: BiteModule,
    contractAddress?: string,
  ) {
    this.contractAddress = contractAddress || CONTRACTS.escrowV2;
    this.contract = new ethers.Contract(this.contractAddress, ESCROW_V2_ABI, this.signer);
  }

  async create(params: CreateEscrowParams): Promise<{ escrowId: number; biteResult?: BiteEncryptResult; txHash: string }> {
    const { seller, token, amount, deadline, requestHash, encrypted } = params;

    const tokenContract = new ethers.Contract(token, ERC20_ABI, this.signer);
    const currentAllowance = await tokenContract.allowance(this.signer.address, this.contractAddress);
    if (currentAllowance < amount) {
      const approveTx = await tokenContract.approve(this.contractAddress, amount, { type: 0, gasLimit: 100000 });
      await approveTx.wait();
    }

    const iface = new ethers.Interface(ESCROW_V2_ABI);
    const data = iface.encodeFunctionData('createEscrow', [
      requestHash,
      seller,
      token,
      amount,
      deadline,
    ]);

    let txHash: string;
    let biteResult: BiteEncryptResult | undefined;

    if (encrypted) {
      biteResult = await this.bite.encryptAndSend(this.contractAddress, data);
      txHash = biteResult.txHash;
    } else {
      txHash = await this.bite.sendPlain(this.contractAddress, data);
    }

    const receipt = await this.provider.getTransactionReceipt(txHash);
    const escrowId = this.parseEscrowId(receipt!);

    return { escrowId, biteResult, txHash };
  }

  async submitResponse(escrowId: number, responseHash: string): Promise<string> {
    const tx = await this.contract.submitResponse(escrowId, responseHash, { type: 0, gasLimit: 200000 });
    const receipt = await tx.wait();
    return receipt!.hash;
  }

  async settle(escrowId: number, matched: boolean): Promise<string> {
    const tx = await this.contract.settle(escrowId, matched, { type: 0, gasLimit: 200000 });
    const receipt = await tx.wait();
    return receipt!.hash;
  }

  async verifyAndSettle(escrowId: number, deliveryProof: string): Promise<{ txHash: string; matched: boolean }> {
    try {
      const tx = await this.contract.verifyAndSettle(escrowId, deliveryProof, { type: 0, gasLimit: 200000 });
      const receipt = await tx.wait();
      return { txHash: receipt!.hash, matched: true };
    } catch (err: any) {
      if (err.message?.includes('Delivery proof mismatch')) {
        return { txHash: '', matched: false };
      }
      throw err;
    }
  }

  async claimRefund(escrowId: number): Promise<string> {
    const tx = await this.contract.claimRefund(escrowId, { type: 0, gasLimit: 200000 });
    const receipt = await tx.wait();
    return receipt!.hash;
  }

  async getEscrow(escrowId: number): Promise<EscrowData> {
    const e = await this.contract.escrows(escrowId);
    return {
      id: escrowId,
      buyer: e[0],
      seller: e[1],
      token: e[2],
      amount: e[3],
      requestTxHash: e[4],
      responseTxHash: e[5],
      deadline: e[6],
      status: Number(e[7]) as EscrowStatus,
    };
  }

  async getEscrowCount(): Promise<number> {
    const count = await this.contract.escrowCount();
    return Number(count);
  }

  private parseEscrowId(receipt: ethers.TransactionReceipt): number {
    const iface = new ethers.Interface(ESCROW_V2_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === 'EscrowCreated') {
          return Number(parsed.args[0]);
        }
      } catch { /* skip non-matching logs */ }
    }
    throw new Error('Could not parse EscrowCreated event from receipt');
  }
}
