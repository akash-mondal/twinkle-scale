// BITE — Blockchain Integrated Threshold Encryption

import { ethers } from 'ethers';
import type { BiteEncryptResult, BiteDecryptResult, BiteCommitResult } from './types.js';

let biteClient: any;

async function getBite(rpcUrl: string) {
  if (!biteClient) {
    const bite = await import('@skalenetwork/bite');
    const ClientClass = (bite as any).BITE || (bite as any).BITEClient || (bite as any).default?.BITE || (bite as any).default;
    biteClient = new ClientClass(rpcUrl);
  }
  return biteClient;
}

export class BiteModule {
  constructor(
    private rpcUrl: string,
    private signer: ethers.Wallet,
  ) {}

  async encryptAndSend(
    to: string,
    data: string,
    gasLimit = 500000,
  ): Promise<BiteEncryptResult> {
    const bite = await getBite(this.rpcUrl);

    const encryptedTx = await bite.encryptTransaction({
      to,
      data,
      value: '0x0',
      gasLimit,
    } as any);

    const sendTime = Date.now();
    const tx = await this.signer.sendTransaction({
      ...encryptedTx,
      type: 0,
    } as any);
    const receipt = await tx.wait();
    const receiptTime = Date.now();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`BITE transaction failed (status=${receipt?.status})`);
    }

    return {
      txHash: tx.hash,
      encrypted: true,
      sendTime,
      receiptTime,
      gasUsed: receipt.gasUsed,
    };
  }

  async decrypt(txHash: string): Promise<BiteDecryptResult> {
    const bite = await getBite(this.rpcUrl);
    const startTime = Date.now();
    const result = await bite.getDecryptedTransactionData(txHash);
    return {
      to: (result as any).to ?? (result as any).To,
      data: (result as any).data ?? (result as any).Data,
      decryptTime: Date.now() - startTime,
    };
  }

  async waitForDecrypt(txHash: string, timeoutMs = 30000): Promise<BiteDecryptResult> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        return await this.decrypt(txHash);
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error(`BITE decrypt timeout after ${timeoutMs}ms for ${txHash}`);
  }

  async encryptData(hexData: string): Promise<string> {
    const bite = await getBite(this.rpcUrl);
    return await bite.encryptMessage(hexData);
  }

  async commitEncrypted(hexData: string): Promise<BiteCommitResult> {
    const bite = await getBite(this.rpcUrl);

    const dataHex = hexData.startsWith('0x') ? hexData : '0x' + hexData;
    const encryptedTx = await bite.encryptTransaction({
      to: this.signer.address,
      data: dataHex,
      value: '0x0',
      gasLimit: '0x493e0',
    });

    const sendTime = Date.now();
    const tx = await this.signer.sendTransaction({
      ...encryptedTx,
      type: 0,
    } as any);
    const receipt = await tx.wait();
    const receiptTime = Date.now();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`BITE commit failed (status=${receipt?.status})`);
    }

    return {
      txHash: tx.hash,
      encrypted: true,
      sendTime,
      receiptTime,
      gasUsed: receipt.gasUsed,
      originalHex: hexData,
    };
  }

  async decryptCommitment(txHash: string): Promise<string> {
    const bite = await getBite(this.rpcUrl);
    const result = await bite.getDecryptedTransactionData(txHash);
    const data = (result as any).data ?? (result as any).Data ?? result;
    return typeof data === 'string' ? data : String(data);
  }

  async sendPlain(to: string, data: string, gasLimit = 500000): Promise<string> {
    const tx = await this.signer.sendTransaction({
      to,
      data,
      gasLimit,
      type: 0,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error('Transaction failed');
    }
    return tx.hash;
  }
}
