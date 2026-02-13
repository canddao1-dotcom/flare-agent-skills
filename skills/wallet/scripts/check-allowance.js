#!/usr/bin/env node
/**
 * Check Token Allowance
 * 
 * Usage: node check-allowance.js <owner> <token> <spender>
 */

const https = require('https');
const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

const KNOWN_TOKENS = {
  'WFLR': { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  'BANK': { address: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', decimals: 18 },
  'FXRP': { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', decimals: 6 },
  'sFLR': { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
};

const KNOWN_SPENDERS = {
  'enosys-v3-router': '0x9D3DE1C1609BbdE64e36a0C7082E2530a0f5a95B',
  'enosys-v3-position': '0xd9770b1c7a6ccd33c75b5bcb1c0078f46be46657',
  'sparkdex-v3-router': '0x7a57DF6665B5b4B9f8C555e19502333D0B89aD59',
};

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

function formatAmount(amount, decimals) {
  if (amount >= BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00')) {
    return 'UNLIMITED';
  }
  const str = amount.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const frac = str.slice(-decimals).replace(/0+$/, '').slice(0, 4);
  return frac ? `${whole}.${frac}` : whole;
}

async function main() {
  const [owner, tokenArg, spenderArg] = process.argv.slice(2);
  
  if (!owner || !tokenArg || !spenderArg) {
    console.log(`
Usage: node check-allowance.js <owner> <token> <spender>

Arguments can be addresses or known names:

Tokens: ${Object.keys(KNOWN_TOKENS).join(', ')}
Spenders: ${Object.keys(KNOWN_SPENDERS).join(', ')}

Example:
  node check-allowance.js 0xYourWallet WFLR enosys-v3-router
`);
    process.exit(1);
  }
  
  // Resolve token
  const token = KNOWN_TOKENS[tokenArg.toUpperCase()] 
    ? KNOWN_TOKENS[tokenArg.toUpperCase()].address 
    : tokenArg;
  const decimals = KNOWN_TOKENS[tokenArg.toUpperCase()]?.decimals || 18;
  
  // Resolve spender
  const spender = KNOWN_SPENDERS[spenderArg] || spenderArg;
  
  // allowance(owner, spender) selector: 0xdd62ed3e
  const data = '0xdd62ed3e' + 
    owner.slice(2).toLowerCase().padStart(64, '0') +
    spender.slice(2).toLowerCase().padStart(64, '0');
  
  const result = await rpcCall('eth_call', [{ to: token, data }, 'latest']);
  const allowance = BigInt(result);
  
  console.log(`\n📋 TOKEN ALLOWANCE\n`);
  console.log(`   Owner:     ${owner}`);
  console.log(`   Token:     ${token}`);
  console.log(`   Spender:   ${spender}`);
  console.log(`   Allowance: ${formatAmount(allowance, decimals)}\n`);
}

main().catch(e => console.error('Error:', e.message));
