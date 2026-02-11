// x402 HTTP client — handles the 402 → sign → retry flow.
// Parameterized for any SKALE chain (V1 or V2).

import { createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { V2_RPC, V2_CHAIN_ID, V2_NETWORK } from './twinkle-config.js';

// Module-level defaults (configurable)
let NETWORK: `eip155:${string}` = V2_NETWORK;
let RPC_URL = V2_RPC;

// Custom viem chain for BITE V2 Sandbox 2
const biteV2Chain: Chain = {
  id: V2_CHAIN_ID,
  name: 'BITE V2 Sandbox 2',
  nativeCurrency: { name: 'sFUEL', symbol: 'sFUEL', decimals: 18 },
  rpcUrls: {
    default: { http: [V2_RPC] },
  },
};

let httpClientInstance: any;
let cachedBuyerPk: string | null = null;

export interface X402PurchaseResult {
  data: any;
  paymentCost: string;
  statusCode: number;
  x402Used: boolean;
}

export function configureX402Client(network: `eip155:${string}`, rpcUrl: string) {
  NETWORK = network;
  RPC_URL = rpcUrl;
  httpClientInstance = null; // Force re-creation
  cachedBuyerPk = null;
}

async function getX402Client(buyerPk: string) {
  if (httpClientInstance && cachedBuyerPk === buyerPk) return httpClientInstance;

  const { x402Client, x402HTTPClient } = await import('@x402/core/client');
  const { registerExactEvmScheme } = await import('@x402/evm/exact/client');

  const account = privateKeyToAccount(buyerPk as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: biteV2Chain,
    transport: http(RPC_URL),
  }) as any;
  walletClient.address = account.address;

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: walletClient, networks: [NETWORK] });
  httpClientInstance = new x402HTTPClient(client);
  cachedBuyerPk = buyerPk;
  return httpClientInstance;
}

export async function purchaseFromX402Endpoint(
  endpoint: string,
  query: string,
  buyerPk: string,
): Promise<X402PurchaseResult> {
  const httpClient = await getX402Client(buyerPk);
  const url = new URL(endpoint);
  url.searchParams.set('q', query);

  const resp = await fetch(url.toString());

  if (resp.status === 200) {
    const data = await resp.json();
    return { data, paymentCost: '0', statusCode: 200, x402Used: false };
  }

  if (resp.status !== 402) {
    const text = await resp.text();
    throw new Error(`Expected 402 or 200, got ${resp.status}: ${text.substring(0, 200)}`);
  }

  const body = await resp.json() as any;
  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (h: string) => resp.headers.get(h),
    body,
  );

  if (!paymentRequired) {
    throw new Error('Could not parse payment requirements from 402 response');
  }

  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paidResp = await fetch(url.toString(), {
    headers: headers as Record<string, string>,
  });

  if (paidResp.status !== 200) {
    const text = await paidResp.text();
    throw new Error(`Payment accepted but data fetch failed: ${paidResp.status}: ${text.substring(0, 200)}`);
  }

  const data = await paidResp.json();
  const cost = body.paymentRequirements?.[0]?.maxAmountRequired ||
               body.accepts?.maxAmountRequired ||
               'unknown';

  return { data, paymentCost: String(cost), statusCode: 200, x402Used: true };
}
