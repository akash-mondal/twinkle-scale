// Chain: BITE V2 Sandbox 2
export const V2_RPC = 'https://base-sepolia-testnet.skalenodes.com/v1/bite-v2-sandbox-2';
export const V2_CHAIN_ID = 103698795;
export const V2_CHAIN_HEX = '0x62e516b';
export const V2_USDC = '0xc4083B1E81ceb461Ccef3FDa8A9F24F0d764B6D8';
export const V2_NETWORK = 'eip155:103698795' as `eip155:${string}`;
export const V2_FACILITATOR = 'https://gateway.kobaru.io';
export const BITE_PRECOMPILE = '0x0000000000000000000000000000000000000100';

// Detection flags (set by scripts, overridable by env)
export let BITE_V2_AVAILABLE = false;
export let X402_AVAILABLE = false;
export let FACILITATOR_URL = V2_FACILITATOR;
export let USDC_ADDRESS = V2_USDC;

// Contract addresses (set after deployment)
export let ESCROW_ADDRESS = '';
export let IDENTITY_ADDRESS = '';
export let REPUTATION_ADDRESS = '';

export function configure(overrides: {
  biteV2?: boolean;
  x402?: boolean;
  facilitator?: string;
  usdc?: string;
  escrow?: string;
  identity?: string;
  reputation?: string;
}) {
  if (overrides.biteV2 !== undefined) BITE_V2_AVAILABLE = overrides.biteV2;
  if (overrides.x402 !== undefined) X402_AVAILABLE = overrides.x402;
  if (overrides.facilitator) FACILITATOR_URL = overrides.facilitator;
  if (overrides.usdc) USDC_ADDRESS = overrides.usdc;
  if (overrides.escrow) ESCROW_ADDRESS = overrides.escrow;
  if (overrides.identity) IDENTITY_ADDRESS = overrides.identity;
  if (overrides.reputation) REPUTATION_ADDRESS = overrides.reputation;
}
