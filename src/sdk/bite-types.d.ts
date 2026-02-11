// Type declaration for the SKALE BITE SDK (loaded dynamically at runtime on SKALE chains)
declare module '@skalenetwork/bite' {
  export class BITE {
    constructor(rpcUrl: string);
    encryptTransaction(params: {
      to: string;
      data: string;
      value: string;
      gasLimit: string | number;
    }): Promise<any>;
    getDecryptedTransactionData(txHash: string): Promise<{ to: string; data: string }>;
    encryptMessage(hexData: string): Promise<string>;
  }
  export class BITEClient extends BITE {}
  export default BITE;
}
