#!/usr/bin/env node
/**
 * Comprehensive Wallet Balance - Flare Network
 */

const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

const MY_WALLET = process.env.AGENT_WALLET || '0xYOUR_WALLET_ADDRESS';

const NETWORKS = {
  flare: {
    name: 'Flare',
    rpc: 'https://flare-api.flare.network/ext/C/rpc',
    explorer: 'https://flarescan.com',
    native: 'FLR',
    tokens: {
      WFLR: { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
      FXRP: { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', decimals: 6 },
      sFLR: { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
      USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
      earnXRP: { address: '0xe533e447fd7720b2f8654da2b1953efa06b60bfa', decimals: 6 },
    }
  }
};

async function rpcCall(rpcUrl, method, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(rpcUrl);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          resolve(r.result);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

function formatBal(balance, decimals) {
  if (!balance) return '0';
  const str = balance.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const frac = str.slice(-decimals).slice(0, 4);
  return frac ? `${whole}.${frac}` : whole;
}

async function getEVMBalances(network, address) {
  const balances = [];
  
  const native = await rpcCall(network.rpc, 'eth_getBalance', [address, 'latest']);
  if (native && native !== '0x' && native !== '0x0') {
    try {
      balances.push({ symbol: network.native, balance: formatBal(BigInt(native), 18) });
    } catch {}
  } else {
    balances.push({ symbol: network.native, balance: '0' });
  }
  
  for (const [symbol, token] of Object.entries(network.tokens)) {
    try {
      const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
      const result = await rpcCall(network.rpc, 'eth_call', [{ to: token.address, data }, 'latest']);
      if (result && result !== '0x' && result !== '0x0') {
        const val = BigInt(result);
        if (val > 0n) {
          balances.push({ symbol, balance: formatBal(val, token.decimals) });
        }
      }
    } catch {}
  }
  
  return balances;
}

async function main() {
  console.log('📊 **WALLET OVERVIEW**');
  console.log('═'.repeat(50));
  
  console.log('\n🔥 **FLARE** (Chain 14)');
  const flareBalances = await getEVMBalances(NETWORKS.flare, MY_WALLET);
  for (const b of flareBalances) {
    console.log(`   ${b.symbol.padEnd(8)} ${b.balance}`);
  }
}

main().catch(console.error);
