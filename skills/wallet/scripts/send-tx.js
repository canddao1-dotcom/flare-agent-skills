#!/usr/bin/env node
/**
 * Send Transaction on Flare Network
 * 
 * Supports native FLR and ERC20 token transfers.
 * Requires encrypted keystore + password.
 * 
 * Usage:
 *   # Send native FLR
 *   node send-tx.js --keystore <path> --to <address> --value <amount>
 *   
 *   # Send ERC20 token
 *   node send-tx.js --keystore <path> --to <address> --value <amount> --token <address>
 *   
 *   # Dry run (estimate gas, don't send)
 *   node send-tx.js --keystore <path> --to <address> --value <amount> --dry-run
 */

const fs = require('fs');
const https = require('https');
const readline = require('readline');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;
const EXPLORER = 'https://flarescan.com';

// Common tokens
const KNOWN_TOKENS = {
  'WFLR': { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  'BANK': { address: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', decimals: 18 },
  'FXRP': { address: '0xad552a648c74d49e10027ab8a618a3ad4901c5be', decimals: 6 },
  'sFLR': { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
};

// Parse command line args
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };
  return {
    keystore: get('--keystore'),
    to: get('--to'),
    value: get('--value'),
    token: get('--token'),
    gasPrice: get('--gas-price'),
    gasLimit: get('--gas-limit'),
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes'), // Skip confirmation
  };
}

async function promptPassword(prompt = 'Enter keystore password: ') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptConfirm(prompt) {
  const answer = await promptPassword(prompt + ' (yes/no): ');
  return answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
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

async function getGasPrice() {
  const result = await rpcCall('eth_gasPrice', []);
  return BigInt(result);
}

async function getNonce(address) {
  const result = await rpcCall('eth_getTransactionCount', [address, 'latest']);
  return parseInt(result, 16);
}

async function estimateGas(tx) {
  const result = await rpcCall('eth_estimateGas', [tx]);
  return BigInt(result);
}

async function sendRawTransaction(signedTx) {
  return await rpcCall('eth_sendRawTransaction', [signedTx]);
}

async function getBalance(address) {
  const result = await rpcCall('eth_getBalance', [address, 'latest']);
  return BigInt(result);
}

async function getTokenBalance(tokenAddress, walletAddress) {
  const data = '0x70a08231' + walletAddress.slice(2).toLowerCase().padStart(64, '0');
  const result = await rpcCall('eth_call', [{ to: tokenAddress, data }, 'latest']);
  return BigInt(result);
}

async function getTokenDecimals(tokenAddress) {
  const result = await rpcCall('eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']);
  return parseInt(result, 16);
}

function parseAmount(amount, decimals) {
  const [whole, frac = ''] = amount.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFrac);
}

function formatAmount(amount, decimals) {
  const str = amount.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const frac = str.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

async function main() {
  const opts = parseArgs();
  
  // Validate required args
  if (!opts.keystore || !opts.to || !opts.value) {
    console.log(`
Usage: node send-tx.js --keystore <path> --to <address> --value <amount> [options]

Options:
  --keystore <path>    Path to encrypted keystore JSON
  --to <address>       Recipient address
  --value <amount>     Amount to send (human readable, e.g., "1.5")
  --token <address>    Token contract address (omit for native FLR)
  --gas-price <gwei>   Override gas price in gwei
  --gas-limit <num>    Override gas limit
  --dry-run            Estimate gas without sending
  --yes                Skip confirmation prompt

Examples:
  # Send 10 FLR
  node send-tx.js --keystore wallet.json --to 0x123... --value 10
  
  # Send 100 BANK tokens
  node send-tx.js --keystore wallet.json --to 0x123... --value 100 --token 0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059
`);
    process.exit(1);
  }
  
  // Load keystore
  if (!fs.existsSync(opts.keystore)) {
    console.error(`❌ Keystore not found: ${opts.keystore}`);
    process.exit(1);
  }
  const keystoreJson = fs.readFileSync(opts.keystore, 'utf8');
  
  // Get password and decrypt
  const password = await promptPassword('🔐 Enter keystore password: ');
  
  console.log('\n⏳ Decrypting keystore...');
  
  let ethers;
  try {
    ethers = require('ethers');
  } catch (e) {
    ethers = require('flarebank/scripts/node_modules/ethers');
  }
  
  let wallet;
  try {
    wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  } catch (e) {
    console.error('❌ Failed to decrypt keystore. Wrong password?');
    process.exit(1);
  }
  
  console.log(`✅ Wallet decrypted: ${wallet.address}\n`);
  
  // Determine if native or token transfer
  const isTokenTransfer = !!opts.token;
  let tokenAddress, tokenDecimals, tokenSymbol;
  
  if (isTokenTransfer) {
    tokenAddress = opts.token;
    // Check if known token
    const known = Object.entries(KNOWN_TOKENS).find(([_, t]) => 
      t.address.toLowerCase() === tokenAddress.toLowerCase()
    );
    if (known) {
      tokenSymbol = known[0];
      tokenDecimals = known[1].decimals;
    } else {
      tokenDecimals = await getTokenDecimals(tokenAddress);
      tokenSymbol = 'TOKEN';
    }
  }
  
  const decimals = isTokenTransfer ? tokenDecimals : 18;
  const symbol = isTokenTransfer ? tokenSymbol : 'FLR';
  const amount = parseAmount(opts.value, decimals);
  
  // Get current balance
  const balance = isTokenTransfer 
    ? await getTokenBalance(tokenAddress, wallet.address)
    : await getBalance(wallet.address);
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('📤 TRANSACTION DETAILS');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   From:   ${wallet.address}`);
  console.log(`   To:     ${opts.to}`);
  console.log(`   Amount: ${opts.value} ${symbol}`);
  if (isTokenTransfer) {
    console.log(`   Token:  ${tokenAddress}`);
  }
  console.log(`   Balance: ${formatAmount(balance, decimals)} ${symbol}`);
  console.log('═══════════════════════════════════════════════════════\n');
  
  // Check sufficient balance
  if (balance < amount) {
    console.error(`❌ Insufficient balance! Have ${formatAmount(balance, decimals)}, need ${opts.value}`);
    process.exit(1);
  }
  
  // Build transaction
  const nonce = await getNonce(wallet.address);
  const gasPrice = opts.gasPrice 
    ? BigInt(opts.gasPrice) * 1000000000n 
    : await getGasPrice();
  
  let tx;
  if (isTokenTransfer) {
    // ERC20 transfer(address,uint256)
    const data = '0xa9059cbb' + 
      opts.to.slice(2).toLowerCase().padStart(64, '0') +
      amount.toString(16).padStart(64, '0');
    tx = {
      to: tokenAddress,
      data,
      nonce,
      gasPrice: '0x' + gasPrice.toString(16),
      chainId: CHAIN_ID,
    };
  } else {
    // Native transfer
    tx = {
      to: opts.to,
      value: '0x' + amount.toString(16),
      nonce,
      gasPrice: '0x' + gasPrice.toString(16),
      chainId: CHAIN_ID,
    };
  }
  
  // Estimate gas
  const estimatedGas = await estimateGas({
    from: wallet.address,
    to: tx.to,
    data: tx.data,
    value: tx.value,
  });
  const gasLimit = opts.gasLimit ? BigInt(opts.gasLimit) : estimatedGas * 120n / 100n; // 20% buffer
  tx.gasLimit = '0x' + gasLimit.toString(16);
  
  const gasCost = gasLimit * gasPrice;
  
  console.log('⛽ GAS ESTIMATE');
  console.log(`   Gas Limit:  ${gasLimit.toString()}`);
  console.log(`   Gas Price:  ${Number(gasPrice) / 1e9} gwei`);
  console.log(`   Max Cost:   ${formatAmount(gasCost, 18)} FLR\n`);
  
  if (opts.dryRun) {
    console.log('🔍 DRY RUN - Transaction not sent');
    process.exit(0);
  }
  
  // Confirm
  if (!opts.yes) {
    const confirmed = await promptConfirm('⚠️  Send this transaction?');
    if (!confirmed) {
      console.log('❌ Transaction cancelled');
      process.exit(0);
    }
  }
  
  // Sign and send
  console.log('\n✍️  Signing transaction...');
  const signedTx = await wallet.signTransaction(tx);
  
  console.log('📡 Broadcasting transaction...');
  const txHash = await sendRawTransaction(signedTx);
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('✅ TRANSACTION SENT!');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Hash: ${txHash}`);
  console.log(`   Explorer: ${EXPLORER}/tx/${txHash}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
