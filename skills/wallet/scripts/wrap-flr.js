#!/usr/bin/env node
/**
 * Wrap/Unwrap FLR ↔ WFLR
 * 
 * Usage:
 *   node wrap-flr.js --keystore <path> --wrap <amount>    # FLR → WFLR
 *   node wrap-flr.js --keystore <path> --unwrap <amount>  # WFLR → FLR
 */

const fs = require('fs');
const https = require('https');
const readline = require('readline');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;
const WFLR = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const EXPLORER = 'https://flarescan.com';

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  return {
    keystore: get('--keystore'),
    wrap: get('--wrap'),
    unwrap: get('--unwrap'),
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes'),
  };
}

async function promptPassword(prompt = 'Enter keystore password: ') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
  });
}

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

function parseAmount(amount) {
  const [whole, frac = ''] = amount.split('.');
  const paddedFrac = frac.padEnd(18, '0').slice(0, 18);
  return BigInt(whole + paddedFrac);
}

async function main() {
  const opts = parseArgs();
  
  if (!opts.keystore || (!opts.wrap && !opts.unwrap)) {
    console.log(`
Usage:
  node wrap-flr.js --keystore <path> --wrap <amount>    # FLR → WFLR
  node wrap-flr.js --keystore <path> --unwrap <amount>  # WFLR → FLR

Options:
  --dry-run    Estimate gas without sending
  --yes        Skip confirmation
`);
    process.exit(1);
  }
  
  const isWrap = !!opts.wrap;
  const amount = parseAmount(opts.wrap || opts.unwrap);
  
  // Load wallet
  const keystoreJson = fs.readFileSync(opts.keystore, 'utf8');
  const password = await promptPassword('🔐 Enter keystore password: ');
  
  console.log('\n⏳ Decrypting keystore...');
  
  let ethers;
  try { ethers = require('ethers'); } 
  catch (e) { ethers = require('flarebank/scripts/node_modules/ethers'); }
  
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  console.log(`✅ Wallet: ${wallet.address}\n`);
  
  // Build transaction
  let tx;
  if (isWrap) {
    // deposit() - sends FLR, receives WFLR
    tx = {
      to: WFLR,
      value: '0x' + amount.toString(16),
      data: '0xd0e30db0', // deposit()
    };
    console.log(`🔄 WRAPPING: ${opts.wrap} FLR → WFLR`);
  } else {
    // withdraw(uint256) - burns WFLR, receives FLR
    tx = {
      to: WFLR,
      data: '0x2e1a7d4d' + amount.toString(16).padStart(64, '0'), // withdraw(amount)
    };
    console.log(`🔄 UNWRAPPING: ${opts.unwrap} WFLR → FLR`);
  }
  
  const nonce = parseInt(await rpcCall('eth_getTransactionCount', [wallet.address, 'latest']), 16);
  const gasPrice = BigInt(await rpcCall('eth_gasPrice', []));
  const gasEstimate = BigInt(await rpcCall('eth_estimateGas', [{
    from: wallet.address,
    ...tx
  }]));
  const gasLimit = gasEstimate * 120n / 100n;
  
  console.log(`\n⛽ Gas: ${gasLimit.toString()} @ ${Number(gasPrice) / 1e9} gwei\n`);
  
  if (opts.dryRun) {
    console.log('🔍 DRY RUN - Transaction not sent');
    process.exit(0);
  }
  
  if (!opts.yes) {
    const confirm = await promptPassword('⚠️  Execute? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log('❌ Cancelled');
      process.exit(0);
    }
  }
  
  tx.nonce = nonce;
  tx.gasPrice = '0x' + gasPrice.toString(16);
  tx.gasLimit = '0x' + gasLimit.toString(16);
  tx.chainId = CHAIN_ID;
  
  console.log('\n✍️  Signing...');
  const signedTx = await wallet.signTransaction(tx);
  
  console.log('📡 Broadcasting...');
  const txHash = await rpcCall('eth_sendRawTransaction', [signedTx]);
  
  console.log(`\n✅ SUCCESS: ${txHash}`);
  console.log(`   ${EXPLORER}/tx/${txHash}\n`);
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
