import { Hono } from 'hono';
import { ethers } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export function walletRoutes(rpcUrl: string, buyerAddress: string, usdcAddress: string): Hono {
  const app = new Hono();

  app.get('/api/wallet/balance', async (c) => {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
      const [balance, decimals, ethBalance] = await Promise.all([
        usdc.balanceOf(buyerAddress),
        usdc.decimals(),
        provider.getBalance(buyerAddress),
      ]);
      return c.json({
        address: buyerAddress,
        usdc: ethers.formatUnits(balance, decimals),
        sFUEL: ethers.formatEther(ethBalance),
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get('/api/config', (c) => {
    return c.json({
      rpcUrl,
      chainId: 103698795,
      usdcAddress,
      explorerUrl: 'https://bite-v2-sandbox-2.explorer.skalenodes.com',
    });
  });

  return app;
}
