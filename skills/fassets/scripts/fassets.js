#!/usr/bin/env node
/**
 * FAssets Mint & Redeem Skill
 * 
 * Interact with FAssets on Flare Network:
 * - Redeem FXRP → XRP on XRPL
 * - Check redemption info (lot size, balance)
 * - Monitor XRPL address for incoming XRP
 * 
 * Usage:
 *   node fassets.js info                                    # Show redemption params
 *   node fassets.js redeem --lots 1 --xrpl-address rXXX... # Redeem FXRP to XRP
 *   node fassets.js status --xrpl-address rXXX...           # Check XRP balance
 * 
 * Dependencies: npm install ethers xrpl
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────
const RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const ASSET_MANAGER = '0x2a3Fe068cD92178554cabcf7c95ADf49B4B0B6A8';

const FXRP_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const AM_ABI = [
  'function redeem(uint256 lots, string underlyingAddress, address executor) payable returns (uint256)',
  'function lotSize() view returns (uint256)',
  'function assetMintingDecimals() view returns (uint256)',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      parsed[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    } else if (!parsed._cmd) {
      parsed._cmd = args[i];
    }
  }
  return parsed;
}

async function loadSigner(keystorePath) {
  if (!keystorePath) {
    // Try default locations
    const defaults = [
      process.env.AGENT_KEYSTORE,
      path.join(process.env.HOME || '', '.agent-keystore.json'),
    ].filter(Boolean);
    
    for (const p of defaults) {
      if (fs.existsSync(p)) { keystorePath = p; break; }
    }
    if (!keystorePath) throw new Error('No keystore found. Use --keystore <path>');
  }

  const ks = fs.readFileSync(keystorePath, 'utf8');
  
  // Try password file
  let password;
  const pwPath = keystorePath.replace('.json', '-password');
  if (fs.existsSync(pwPath)) {
    password = fs.readFileSync(pwPath, 'utf8').trim();
  } else if (process.env.KEYSTORE_PASSWORD) {
    password = process.env.KEYSTORE_PASSWORD;
  } else {
    throw new Error('No password found. Set KEYSTORE_PASSWORD or create password file');
  }

  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = await ethers.Wallet.fromEncryptedJson(ks, password);
  return wallet.connect(provider);
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function info(args) {
  const provider = new ethers.JsonRpcProvider(RPC);
  const am = new ethers.Contract(ASSET_MANAGER, AM_ABI, provider);
  const fxrp = new ethers.Contract(FXRP, FXRP_ABI, provider);

  const lotSize = await am.lotSize();
  const decimals = await fxrp.decimals();

  console.log('📊 FAssets Redemption Info');
  console.log('═══════════════════════════════');
  console.log(`  FXRP Token:      ${FXRP}`);
  console.log(`  AssetManager:    ${ASSET_MANAGER}`);
  console.log(`  Lot Size:        ${ethers.formatUnits(lotSize, decimals)} FXRP`);
  console.log(`  Decimals:        ${decimals}`);
  console.log(`  Min Redemption:  1 lot (${ethers.formatUnits(lotSize, decimals)} FXRP)`);
  console.log('');
  console.log('💡 To redeem: node fassets.js redeem --lots 1 --xrpl-address rXXX...');

  // If address provided, show balance
  if (args.address) {
    const bal = await fxrp.balanceOf(args.address);
    const lots = bal / lotSize;
    console.log('');
    console.log(`  FXRP Balance:    ${ethers.formatUnits(bal, decimals)}`);
    console.log(`  Redeemable Lots: ${lots} (${ethers.formatUnits(lots * lotSize, decimals)} FXRP)`);
  }
}

async function redeem(args) {
  if (!args.xrplAddress) throw new Error('--xrpl-address required');
  const lots = parseInt(args.lots || '1');
  if (lots < 1) throw new Error('--lots must be >= 1');

  // Validate XRPL address format
  if (!args.xrplAddress.match(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)) {
    throw new Error('Invalid XRPL address format');
  }

  const signer = await loadSigner(args.keystore);
  const provider = signer.provider;
  const fxrp = new ethers.Contract(FXRP, FXRP_ABI, signer);
  const am = new ethers.Contract(ASSET_MANAGER, AM_ABI, signer);

  const lotSize = await am.lotSize();
  const decimals = await fxrp.decimals();
  const required = lotSize * BigInt(lots);
  const balance = await fxrp.balanceOf(signer.address);

  console.log('🔄 FAssets Redemption');
  console.log('═══════════════════════════════');
  console.log(`  Wallet:       ${signer.address}`);
  console.log(`  FXRP Balance: ${ethers.formatUnits(balance, decimals)}`);
  console.log(`  Redeeming:    ${lots} lot(s) = ${ethers.formatUnits(required, decimals)} FXRP`);
  console.log(`  XRPL Dest:    ${args.xrplAddress}`);
  console.log('');

  if (balance < required) {
    throw new Error(`Insufficient FXRP. Need ${ethers.formatUnits(required, decimals)}, have ${ethers.formatUnits(balance, decimals)}`);
  }

  // Approve if needed
  const allowance = await fxrp.allowance(signer.address, ASSET_MANAGER);
  if (allowance < required) {
    console.log('📝 Approving FXRP to AssetManager...');
    const atx = await fxrp.approve(ASSET_MANAGER, ethers.MaxUint256);
    await atx.wait();
    console.log('✅ Approved');
  }

  // Redeem
  console.log(`🔥 Redeeming ${lots} lot(s)...`);
  const tx = await am.redeem(lots, args.xrplAddress, ethers.ZeroAddress);
  console.log(`  TX: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✅ Confirmed (gas: ${receipt.gasUsed})`);
  console.log('');
  console.log('⏳ Agent will send XRP to your XRPL address shortly (usually < 5 min)');
  console.log(`  Monitor: node fassets.js status --xrpl-address ${args.xrplAddress}`);
  console.log(`  Explorer: https://flarescan.com/tx/${tx.hash}`);

  // Check remaining balance
  const remaining = await fxrp.balanceOf(signer.address);
  console.log(`  FXRP remaining: ${ethers.formatUnits(remaining, decimals)}`);
}

async function status(args) {
  if (!args.xrplAddress) throw new Error('--xrpl-address required');

  let xrpl;
  try {
    xrpl = require('xrpl');
  } catch (e) {
    console.error('❌ Missing dependency: xrpl');
    console.error('   Run: npm install xrpl');
    process.exit(1);
  }

  const client = new xrpl.Client('wss://xrplcluster.com');
  await client.connect();

  console.log('📊 XRPL Account Status');
  console.log('═══════════════════════════════');
  console.log(`  Address: ${args.xrplAddress}`);

  try {
    const info = await client.request({
      command: 'account_info',
      account: args.xrplAddress,
    });
    const balance = xrpl.dropsToXrp(info.result.account_data.Balance);
    console.log(`  Balance: ${balance} XRP`);
    console.log(`  Status:  ✅ Active`);

    // Recent transactions
    const txs = await client.request({
      command: 'account_tx',
      account: args.xrplAddress,
      limit: 5,
    });
    if (txs.result.transactions?.length) {
      console.log('');
      console.log('  Recent Transactions:');
      for (const t of txs.result.transactions) {
        const tx = t.tx || t.tx_json;
        const amount = typeof tx.Amount === 'string' ? xrpl.dropsToXrp(tx.Amount) : 'token';
        const dir = tx.Destination === args.xrplAddress ? '📥 IN' : '📤 OUT';
        console.log(`    ${dir} ${amount} XRP | ${tx.TransactionType} | ${t.validated ? '✅' : '⏳'}`);
      }
    }
  } catch (e) {
    if (e.data?.error === 'actNotFound') {
      console.log(`  Balance: 0 XRP`);
      console.log(`  Status:  ⚠️ Not activated (needs ≥10 XRP)`);
    } else {
      console.log(`  Error: ${e.message}`);
    }
  }

  await client.disconnect();
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._cmd || 'info';

  switch (cmd) {
    case 'info':    return info(args);
    case 'redeem':  return redeem(args);
    case 'status':  return status(args);
    default:
      console.log('Usage: node fassets.js <command> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  info                          Show redemption parameters');
      console.log('  redeem --lots N --xrpl-address rXXX...  Redeem FXRP to XRP');
      console.log('  status --xrpl-address rXXX... Check XRPL balance');
      console.log('');
      console.log('Options:');
      console.log('  --keystore <path>    Path to encrypted keystore');
      console.log('  --address <0x...>    Flare address (for info)');
      console.log('  --lots <N>           Number of lots to redeem (default: 1)');
      console.log('  --xrpl-address <r..> Destination XRPL address');
  }
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
