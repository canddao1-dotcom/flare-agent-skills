#!/usr/bin/env node
/**
 * Check current gas prices on Flare
 */

const https = require('https');
const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

async function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(RPC_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.error) reject(new Error(result.error.message));
          else resolve(result.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const gasPrice = BigInt(await rpcCall('eth_gasPrice', []));
  const block = await rpcCall('eth_getBlockByNumber', ['latest', false]);
  const baseFee = block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null;
  
  console.log('\n⛽ FLARE GAS PRICES\n');
  console.log(`   Current Gas Price: ${Number(gasPrice) / 1e9} gwei`);
  if (baseFee) {
    console.log(`   Base Fee:          ${Number(baseFee) / 1e9} gwei`);
  }
  console.log(`   Block Number:      ${parseInt(block.number, 16)}`);
  console.log(`   Block Time:        ${new Date(parseInt(block.timestamp, 16) * 1000).toISOString()}`);
  
  // Estimate costs for common operations
  const estimates = {
    'Native Transfer': 21000n,
    'ERC20 Transfer': 65000n,
    'ERC20 Approval': 46000n,
    'Uniswap V3 Swap': 150000n,
    'Add Liquidity': 300000n,
  };
  
  console.log('\n📊 ESTIMATED TX COSTS (at current gas price)\n');
  for (const [op, gas] of Object.entries(estimates)) {
    const cost = gas * gasPrice;
    const flr = Number(cost) / 1e18;
    console.log(`   ${op.padEnd(20)} ${flr.toFixed(6)} FLR`);
  }
  console.log('');
}

main().catch(e => console.error('Error:', e.message));
