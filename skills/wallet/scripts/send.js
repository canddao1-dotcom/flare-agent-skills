#!/usr/bin/env node
/**
 * Safe Token Send - Maximum safety for token transfers
 * 
 * Features:
 * - Address validation against known addresses
 * - Balance check before sending
 * - Dry-run by default
 * - Requires explicit --confirm flag
 * - Automatic memory logging
 * 
 * Usage:
 *   # Dry run (default)
 *   node send.js --to 0x... --amount 100 --token FLR
 *   
 *   # Execute with confirmation
 *   node send.js --to 0x... --amount 100 --token FLR --confirm --keystore <path>
 */

const fs = require('fs');
const https = require('https');
const readline = require('readline');
const { execSync } = require('child_process');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;
const EXPLORER = 'https://flarescan.com';
const MEMORY_LOG = process.env.MEMORY_LOG || './memory-log.js';

// Address book - add your own aliases here
// Format: 'ALIAS': { address: '0x...', name: 'Description' }
const KNOWN_ADDRESSES = {
  // Example:
  // 'TREASURY': { address: '0x1234...', name: 'My Treasury' },
};

// Known tokens
const KNOWN_TOKENS = {
  'FLR': { address: null, decimals: 18, name: 'Flare (native)' },
  'WFLR': { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18, name: 'Wrapped FLR' },
  'FXRP': { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', decimals: 6, name: 'FAsset XRP' },
  'SFLR': { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18, name: 'Staked FLR' },
  'RFLR': { address: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e', decimals: 18, name: 'Reward FLR' },
  'USDT0': { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6, name: 'USD₮0' },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  return {
    to: get('--to'),
    amount: get('--amount'),
    token: (get('--token') || 'FLR').toUpperCase(),
    keystore: get('--keystore'),
    from: get('--from'),
    confirm: args.includes('--confirm'),
    yes: args.includes('--yes'),
    gasLimit: get('--gas-limit'),
    gasPrice: get('--gas-price'),
  };
}

function rpcCall(method, params = []) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const url = new URL(RPC_URL);
    
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function resolveAddress(input) {
  if (!input) return null;
  
  // Check if it's a known alias
  const upper = input.toUpperCase();
  if (KNOWN_ADDRESSES[upper]) {
    return KNOWN_ADDRESSES[upper];
  }
  
  // Check if any known address matches
  const inputLower = input.toLowerCase();
  for (const [alias, info] of Object.entries(KNOWN_ADDRESSES)) {
    if (info.address.toLowerCase() === inputLower) {
      return { ...info, alias };
    }
  }
  
  // Unknown address
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) {
    return { address: input.toLowerCase(), name: 'UNKNOWN ADDRESS', unknown: true };
  }
  
  return null;
}

function resolveToken(input) {
  const upper = (input || 'FLR').toUpperCase();
  if (KNOWN_TOKENS[upper]) {
    return { symbol: upper, ...KNOWN_TOKENS[upper] };
  }
  
  // Check if it's an address
  if (/^0x[a-fA-F0-9]{40}$/.test(input)) {
    return { symbol: 'UNKNOWN', address: input.toLowerCase(), decimals: 18, name: 'Unknown Token' };
  }
  
  return null;
}

async function getBalance(address, tokenAddress) {
  if (!tokenAddress) {
    const balance = await rpcCall('eth_getBalance', [address, 'latest']);
    return BigInt(balance);
  }
  
  const data = '0x70a08231000000000000000000000000' + address.slice(2);
  const result = await rpcCall('eth_call', [{ to: tokenAddress, data }, 'latest']);
  return BigInt(result || '0x0');
}

function formatUnits(value, decimals) {
  const str = value.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, -decimals) || '0';
  const decPart = str.slice(-decimals).replace(/0+$/, '');
  return decPart ? `${intPart}.${decPart}` : intPart;
}

function parseUnits(value, decimals) {
  const [intPart, decPart = ''] = value.split('.');
  const paddedDec = decPart.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(intPart + paddedDec);
}

function logToMemory(action, details, tx) {
  try {
    const cmd = `node "${MEMORY_LOG}" --type TX --action "${action}" --details "${details}"${tx ? ` --tx "${tx}"` : ''}`;
    execSync(cmd, { encoding: 'utf8' });
  } catch (e) {
    console.error('⚠️ Failed to log to memory:', e.message);
  }
}

async function promptConfirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'confirm' || answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const args = parseArgs();
  
  if (!args.to || !args.amount) {
    console.error('Usage: node send.js --to <address|alias> --amount <number> [--token TOKEN] [--confirm] [--keystore <path>]');
    console.error('\nKnown addresses:', Object.keys(KNOWN_ADDRESSES).join(', ') || '(none configured)');
    console.error('Known tokens:', Object.keys(KNOWN_TOKENS).join(', '));
    process.exit(1);
  }
  
  const dest = resolveAddress(args.to);
  if (!dest) {
    console.error('❌ Invalid destination address:', args.to);
    process.exit(1);
  }
  
  const token = resolveToken(args.token);
  if (!token) {
    console.error('❌ Unknown token:', args.token);
    process.exit(1);
  }
  
  const amount = parseUnits(args.amount, token.decimals);
  const amountStr = formatUnits(amount, token.decimals);
  
  let fromAddress = args.from;
  if (!fromAddress && args.keystore) {
    try {
      const ks = JSON.parse(fs.readFileSync(args.keystore, 'utf8'));
      fromAddress = '0x' + ks.address;
    } catch (e) {
      console.error('❌ Could not read keystore:', e.message);
    }
  }
  
  if (!fromAddress) {
    console.error('❌ No source address. Use --from or --keystore');
    process.exit(1);
  }
  
  const fromInfo = resolveAddress(fromAddress);
  
  console.log('\n' + '━'.repeat(50));
  console.log('⚠️  SEND CONFIRMATION');
  console.log('━'.repeat(50));
  console.log(`Token:   ${token.symbol} (${token.name})`);
  console.log(`Amount:  ${amountStr} ${token.symbol}`);
  console.log(`To:      ${dest.address}`);
  console.log(`         ${dest.name}${dest.unknown ? ' ⚠️ NOT IN KNOWN LIST' : ''}`);
  console.log(`From:    ${fromAddress}`);
  console.log(`         ${fromInfo?.name || 'Unknown'}`);
  console.log('━'.repeat(50));
  
  try {
    const balance = await getBalance(fromAddress, token.address);
    const balanceStr = formatUnits(balance, token.decimals);
    const afterBalance = balance - amount;
    const afterStr = formatUnits(afterBalance > 0n ? afterBalance : 0n, token.decimals);
    
    console.log(`Balance: ${balanceStr} ${token.symbol}`);
    console.log(`After:   ${afterStr} ${token.symbol}`);
    
    if (balance < amount) {
      console.error('\n❌ INSUFFICIENT BALANCE');
      process.exit(1);
    }
    
    if (amount > (balance * 9n / 10n)) {
      console.log('\n⚠️  WARNING: Sending >90% of balance!');
    }
  } catch (e) {
    console.error('\n⚠️ Could not check balance:', e.message);
  }
  
  console.log('━'.repeat(50));
  
  if (dest.unknown) {
    console.log('\n🚨 UNKNOWN ADDRESS - NOT IN WHITELIST');
    console.log('   Double-check this address is correct!');
  }
  
  if (!args.confirm) {
    console.log('\n📋 DRY RUN - No transaction sent');
    console.log('   Add --confirm --keystore <path> to execute');
    return;
  }
  
  if (!args.keystore) {
    console.error('\n❌ --keystore required for actual send');
    process.exit(1);
  }
  
  if (!args.yes) {
    console.log('\n');
    const confirmed = await promptConfirm('Type "confirm" to proceed: ');
    if (!confirmed) {
      console.log('❌ Cancelled');
      process.exit(0);
    }
  }
  
  console.log('\n🔄 Executing transaction...');
  
  const sendTxScript = __dirname + '/send-tx.js';
  let cmd = `node "${sendTxScript}" --keystore "${args.keystore}" --to "${dest.address}" --value "${args.amount}"`;
  
  if (token.address) {
    cmd += ` --token "${token.address}"`;
  }
  
  cmd += ' --yes';
  
  try {
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(output);
    
    const txMatch = output.match(/0x[a-fA-F0-9]{64}/);
    const txHash = txMatch ? txMatch[0] : null;
    
    const details = `${amountStr} ${token.symbol} → ${dest.address.slice(0, 6)}...${dest.address.slice(-4)} (${dest.name})`;
    logToMemory('SEND', details, txHash);
    
    console.log('\n✅ Transaction sent and logged to memory');
    
    if (txHash) {
      console.log(`📜 View: ${EXPLORER}/tx/${txHash}`);
    }
  } catch (e) {
    console.error('❌ Transaction failed:', e.message);
    logToMemory('SEND_FAILED', `${amountStr} ${token.symbol} → ${dest.address}`, null);
    process.exit(1);
  }
}

main().catch(console.error);
