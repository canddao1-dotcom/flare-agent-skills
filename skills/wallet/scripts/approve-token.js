#!/usr/bin/env node
/**
 * Approve Token Spending
 * 
 * Approves a spender (usually a DEX or contract) to spend tokens on your behalf.
 * Required before interacting with DEXes, LPs, or other DeFi contracts.
 * 
 * Usage:
 *   node approve-token.js --keystore <path> --token <address> --spender <address> [--amount <num>]
 *   
 * If amount is omitted, approves max (unlimited).
 */

const fs = require('fs');
const https = require('https');
const readline = require('readline');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;
const EXPLORER = 'https://flarescan.com';
const MAX_UINT256 = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

// Known spenders
const KNOWN_SPENDERS = {
  'enosys-v3-router': '0x9D3DE1C1609BbdE64e36a0C7082E2530a0f5a95B',
  'enosys-v3-position': '0xd9770b1c7a6ccd33c75b5bcb1c0078f46be46657',
  'sparkdex-v3-router': '0x7a57DF6665B5b4B9f8C555e19502333D0B89aD59',
  'blazeswap-router': '0xe3c2a5C86F47aE9Ea2dBB3B0e0E66A7E0Ff71A70',
};

const KNOWN_TOKENS = {
  'WFLR': { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  'BANK': { address: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', decimals: 18 },
  'FXRP': { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', decimals: 6 },
  'sFLR': { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  return {
    keystore: get('--keystore'),
    token: get('--token'),
    spender: get('--spender'),
    amount: get('--amount'),
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
  const opts = parseArgs();
  
  if (!opts.keystore || !opts.token || !opts.spender) {
    console.log(`
Usage: node approve-token.js --keystore <path> --token <address> --spender <address> [options]

Options:
  --keystore <path>    Path to encrypted keystore JSON
  --token <address>    Token contract address (or symbol: WFLR, BANK, FXRP, sFLR)
  --spender <address>  Spender address (or name: enosys-v3-router, sparkdex-v3-router)
  --amount <num>       Amount to approve (omit for unlimited)
  --dry-run            Estimate gas without sending
  --yes                Skip confirmation prompt

Known Spenders:
${Object.entries(KNOWN_SPENDERS).map(([k,v]) => `  ${k}: ${v}`).join('\n')}

Known Tokens:
${Object.entries(KNOWN_TOKENS).map(([k,v]) => `  ${k}: ${v.address}`).join('\n')}
`);
    process.exit(1);
  }
  
  // Resolve token
  let tokenAddress = opts.token;
  let tokenDecimals = 18;
  const knownToken = KNOWN_TOKENS[opts.token.toUpperCase()];
  if (knownToken) {
    tokenAddress = knownToken.address;
    tokenDecimals = knownToken.decimals;
  }
  
  // Resolve spender
  let spenderAddress = opts.spender;
  if (KNOWN_SPENDERS[opts.spender]) {
    spenderAddress = KNOWN_SPENDERS[opts.spender];
  }
  
  // Load and decrypt keystore
  const keystoreJson = fs.readFileSync(opts.keystore, 'utf8');
  const password = await promptPassword('🔐 Enter keystore password: ');
  
  console.log('\n⏳ Decrypting keystore...');
  
  let ethers;
  try { ethers = require('ethers'); } 
  catch (e) { ethers = require('flarebank/scripts/node_modules/ethers'); }
  
  const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  console.log(`✅ Wallet: ${wallet.address}\n`);
  
  // Build approval amount
  let approvalAmount;
  if (opts.amount) {
    const [whole, frac = ''] = opts.amount.split('.');
    const paddedFrac = frac.padEnd(tokenDecimals, '0').slice(0, tokenDecimals);
    approvalAmount = '0x' + BigInt(whole + paddedFrac).toString(16).padStart(64, '0');
  } else {
    approvalAmount = MAX_UINT256.slice(2); // Unlimited
  }
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('📝 APPROVAL DETAILS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Token:   ${tokenAddress}`);
  console.log(`   Spender: ${spenderAddress}`);
  console.log(`   Amount:  ${opts.amount || 'UNLIMITED (max uint256)'}`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Build tx data: approve(address,uint256)
  const data = '0x095ea7b3' + 
    spenderAddress.slice(2).toLowerCase().padStart(64, '0') +
    (opts.amount ? approvalAmount : MAX_UINT256.slice(2));
  
  const nonce = parseInt(await rpcCall('eth_getTransactionCount', [wallet.address, 'latest']), 16);
  const gasPrice = BigInt(await rpcCall('eth_gasPrice', []));
  const gasEstimate = BigInt(await rpcCall('eth_estimateGas', [{
    from: wallet.address,
    to: tokenAddress,
    data
  }]));
  const gasLimit = gasEstimate * 120n / 100n;
  
  console.log('⛽ GAS ESTIMATE');
  console.log(`   Gas Limit: ${gasLimit.toString()}`);
  console.log(`   Gas Price: ${Number(gasPrice) / 1e9} gwei\n`);
  
  if (opts.dryRun) {
    console.log('🔍 DRY RUN - Transaction not sent');
    process.exit(0);
  }
  
  if (!opts.yes) {
    const confirm = await promptPassword('⚠️  Approve this spender? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log('❌ Cancelled');
      process.exit(0);
    }
  }
  
  const tx = {
    to: tokenAddress,
    data,
    nonce,
    gasPrice: '0x' + gasPrice.toString(16),
    gasLimit: '0x' + gasLimit.toString(16),
    chainId: CHAIN_ID,
  };
  
  console.log('\n✍️  Signing...');
  const signedTx = await wallet.signTransaction(tx);
  
  console.log('📡 Broadcasting...');
  const txHash = await rpcCall('eth_sendRawTransaction', [signedTx]);
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅ APPROVAL SENT!');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Hash: ${txHash}`);
  console.log(`   Explorer: ${EXPLORER}/tx/${txHash}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
