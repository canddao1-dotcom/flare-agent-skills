#!/usr/bin/env node
/**
 * Get Token Information
 * 
 * Usage: node token-info.js <token_address>
 */

const https = require('https');
const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

async function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(RPC_URL);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const result = JSON.parse(body);
        if (result.error) reject(new Error(result.error.message));
        else resolve(result.result);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  try {
    // Try dynamic string (offset + length + data)
    const stripped = hex.slice(2);
    if (stripped.length >= 128) {
      const offset = parseInt(stripped.slice(0, 64), 16);
      const length = parseInt(stripped.slice(offset * 2, offset * 2 + 64), 16);
      const data = stripped.slice(offset * 2 + 64, offset * 2 + 64 + length * 2);
      return Buffer.from(data, 'hex').toString('utf8');
    }
    // Try fixed bytes32
    return Buffer.from(stripped.replace(/00+$/, ''), 'hex').toString('utf8');
  } catch {
    return null;
  }
}

async function main() {
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.log('Usage: node token-info.js <token_address>');
    process.exit(1);
  }
  
  console.log(`\n📋 TOKEN INFO: ${tokenAddress}\n`);
  
  // name()
  try {
    const name = await rpcCall('eth_call', [{ to: tokenAddress, data: '0x06fdde03' }, 'latest']);
    console.log(`   Name:     ${decodeString(name) || 'N/A'}`);
  } catch { console.log('   Name:     N/A'); }
  
  // symbol()
  try {
    const symbol = await rpcCall('eth_call', [{ to: tokenAddress, data: '0x95d89b41' }, 'latest']);
    console.log(`   Symbol:   ${decodeString(symbol) || 'N/A'}`);
  } catch { console.log('   Symbol:   N/A'); }
  
  // decimals()
  try {
    const decimals = await rpcCall('eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']);
    console.log(`   Decimals: ${parseInt(decimals, 16)}`);
  } catch { console.log('   Decimals: N/A'); }
  
  // totalSupply()
  try {
    const supply = await rpcCall('eth_call', [{ to: tokenAddress, data: '0x18160ddd' }, 'latest']);
    const decimals = parseInt(await rpcCall('eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']), 16);
    const supplyBig = BigInt(supply);
    const formatted = Number(supplyBig) / Math.pow(10, decimals);
    console.log(`   Supply:   ${formatted.toLocaleString()}`);
  } catch { console.log('   Supply:   N/A'); }
  
  console.log(`\n   Explorer: https://flarescan.com/token/${tokenAddress}\n`);
}

main().catch(e => console.error('Error:', e.message));
