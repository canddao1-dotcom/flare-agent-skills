#!/usr/bin/env node
/**
 * Check wallet balance - Multi-Network Support
 * 
 * Usage:
 *   node balance.js <address>
 *   node balance.js <address> --tokens
 */

const https = require('https');
const { getNetwork, listNetworks, DEFAULT_NETWORK } = require('./networks');

async function rpcCall(rpcUrl, method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(rpcUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : require('http');
    
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
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
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getNativeBalance(rpcUrl, address) {
  const result = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  return BigInt(result);
}

async function getTokenBalance(rpcUrl, tokenAddress, walletAddress) {
  // balanceOf(address) selector: 0x70a08231
  const data = '0x70a08231' + walletAddress.slice(2).toLowerCase().padStart(64, '0');
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
  return BigInt(result);
}

function formatBalance(balance, decimals) {
  const str = balance.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const frac = str.slice(-decimals);
  const trimmedFrac = frac.replace(/0+$/, '').slice(0, 6);
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}

function showHelp() {
  console.log(`
Check Wallet Balance (Multi-Network)

Usage: node balance.js <address> [options]

Options:
  --network <name>    Network to use (default: flare)
  --tokens            Include token balances
  --help              Show this help

Networks:
${listNetworks().map(n => `  ${n.key.padEnd(10)} ${n.name} (${n.nativeSymbol})`).join('\n')}

Examples:
  node balance.js 0x...                      # Flare balance
  node balance.js 0x... --tokens             # Include all tokens
`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  // Parse --network flag
  const netIndex = args.findIndex(a => a === '--network' || a === '-n');
  const networkName = netIndex !== -1 ? args[netIndex + 1] : DEFAULT_NETWORK;
  
  const network = getNetwork(networkName);
  if (!network) {
    console.error(`Unknown network: ${networkName}`);
    console.log('Available:', listNetworks().map(n => n.key).join(', '));
    process.exit(1);
  }
  
  const address = args.find(a => a.startsWith('0x'));
  const showTokens = args.includes('--tokens');
  
  if (!address) {
    console.error('Usage: node balance.js <address> [--network <name>] [--tokens]');
    process.exit(1);
  }
  
  console.log(`\n🌐 Network: ${network.name} (Chain ${network.chainId})`);
  console.log(`📍 Address: ${address}\n`);
  
  // Native balance
  const nativeBalance = await getNativeBalance(network.rpc, address);
  console.log(`💰 ${network.nativeSymbol}: ${formatBalance(nativeBalance, 18)}`);
  
  if (showTokens && network.tokens) {
    console.log('\n📦 Token Balances:');
    for (const [symbol, token] of Object.entries(network.tokens)) {
      try {
        const balance = await getTokenBalance(network.rpc, token.address, address);
        if (balance > 0n) {
          console.log(`   ${symbol}: ${formatBalance(balance, token.decimals)}`);
        }
      } catch (e) {
        // Skip errors
      }
    }
  }
  
  console.log(`\n🔗 ${network.explorer}/address/${address}\n`);
}


main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
