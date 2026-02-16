#!/usr/bin/env node
/**
 * FAssets Mint & Redeem Skill
 * 
 * Full pipeline for FAssets on Flare Network:
 * - Mint FXRP: Reserve collateral → Send XRP on XRPL → Wait for FDC → FXRP minted
 * - Redeem FXRP: Burn FXRP → Agent sends XRP to your XRPL address
 * - Check info, status, and balances
 * 
 * Usage:
 *   node fassets.js info                                         # Show params
 *   node fassets.js mint --lots 1 --xrpl-address rXXX...         # Mint FXRP
 *   node fassets.js redeem --lots 1 --xrpl-address rXXX...       # Redeem FXRP
 *   node fassets.js status --xrpl-address rXXX...                # Check XRP balance
 *   node fassets.js agents                                       # List available agents
 * 
 * Dependencies: npm install ethers xrpl
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────
const RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';
const XRPL_WSS = process.env.XRPL_WSS || 'wss://xrplcluster.com';
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
  'function reserveCollateral(address agentVault, uint256 lots, uint256 maxMintingFeeBIPS, address executorAddress) payable returns (uint256)',
  'function collateralReservationFee(uint256 lots) view returns (uint256)',
  'function lotSize() view returns (uint256)',
  'function assetMintingDecimals() view returns (uint256)',
  'function getAvailableAgentsDetailedList(uint256 start, uint256 end) view returns (tuple(address agentVault, uint256 freeCollateralLots)[])',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseArgs(args) {
  const parsed = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      parsed[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    } else if (!parsed._cmd) {
      parsed._cmd = args[i];
    } else {
      positional.push(args[i]);
    }
  }
  // Natural language: "mint 10 FXRP" or "mint 20" → convert to lots
  // Also supports "mint --lots 2"
  if (!parsed.lots && positional.length > 0) {
    const num = parseFloat(positional[0]);
    if (!isNaN(num) && num > 0) {
      // If specified in FXRP/XRP amounts, convert to lots (1 lot = 10 FXRP)
      if (num >= 10) {
        parsed.lots = Math.floor(num / 10).toString();
      } else {
        parsed.lots = num.toString(); // assume lots if < 10
      }
    }
  }
  return parsed;
}

async function loadSigner(keystorePath) {
  if (!keystorePath) {
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

function loadXrplWallet(xrplKeyPath) {
  let xrpl;
  try { xrpl = require('xrpl'); } catch (e) {
    throw new Error('Missing dependency: xrpl. Run: npm install xrpl');
  }

  if (!xrplKeyPath) {
    const defaults = [
      process.env.XRPL_WALLET,
      path.join(process.env.HOME || '', '.secrets', 'xrpl-wallet.json'),
      path.join(process.env.HOME || '', '.openclaw', 'workspace', '.secrets', 'xrpl-wallet.json'),
    ].filter(Boolean);
    for (const p of defaults) {
      if (fs.existsSync(p)) { xrplKeyPath = p; break; }
    }
    if (!xrplKeyPath) throw new Error('No XRPL wallet found. Use --xrpl-key <path> or create with create-xrpl-wallet.js');
  }

  const data = JSON.parse(fs.readFileSync(xrplKeyPath, 'utf8'));
  return { wallet: xrpl.Wallet.fromSeed(data.secret), address: data.address, xrpl };
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function info(args) {
  const provider = new ethers.JsonRpcProvider(RPC);
  const am = new ethers.Contract(ASSET_MANAGER, AM_ABI, provider);
  const fxrp = new ethers.Contract(FXRP, FXRP_ABI, provider);

  const lotSize = await am.lotSize();
  const decimals = await fxrp.decimals();
  const fee1 = await am.collateralReservationFee(1);

  console.log('📊 FAssets Info');
  console.log('═══════════════════════════════');
  console.log(`  FXRP Token:        ${FXRP}`);
  console.log(`  AssetManager:      ${ASSET_MANAGER}`);
  console.log(`  Lot Size:          ${ethers.formatUnits(lotSize, decimals)} FXRP (= XRP)`);
  console.log(`  Decimals:          ${decimals}`);
  console.log(`  Reservation Fee:   ${ethers.formatEther(fee1)} FLR per lot`);
  console.log('');

  if (args.address) {
    const bal = await fxrp.balanceOf(args.address);
    const lots = bal / lotSize;
    console.log(`  FXRP Balance:      ${ethers.formatUnits(bal, decimals)}`);
    console.log(`  Redeemable Lots:   ${lots}`);
  }
}

async function agents(args) {
  const provider = new ethers.JsonRpcProvider(RPC);
  const am = new ethers.Contract(ASSET_MANAGER, AM_ABI, provider);

  const list = await am.getAvailableAgentsDetailedList(0, 20);
  console.log('📋 Available Agents');
  console.log('═══════════════════════════════');
  
  let valid = 0;
  for (const a of list) {
    const lots = a.freeCollateralLots;
    // Filter out obviously invalid addresses (all zeros etc)
    if (lots >= 1n && a.agentVault !== ethers.ZeroAddress) {
      console.log(`  ${a.agentVault}`);
      console.log(`    Free lots: ${lots > 1000000n ? '∞' : lots.toString()}`);
      valid++;
    }
  }
  console.log(`\n  Total: ${valid} agents with capacity`);
}

async function mint(args) {
  const lots = parseInt(args.lots || '1');
  if (lots < 1) throw new Error('--lots must be >= 1');

  // Load XRPL wallet
  const { wallet: xrplWallet, address: xrplAddress, xrpl } = loadXrplWallet(args.xrplKey);
  console.log(`  XRPL Wallet: ${xrplAddress}`);

  // Load Flare signer
  const signer = await loadSigner(args.keystore);
  const provider = signer.provider;
  const am = new ethers.Contract(ASSET_MANAGER, AM_ABI, signer);
  const fxrp = new ethers.Contract(FXRP, FXRP_ABI, provider);
  const decimals = await fxrp.decimals();
  const lotSize = await am.lotSize();

  console.log('🔄 FAssets Minting');
  console.log('═══════════════════════════════');
  console.log(`  Flare Wallet:  ${signer.address}`);
  console.log(`  XRPL Wallet:   ${xrplAddress}`);
  console.log(`  Lots:          ${lots} (${ethers.formatUnits(lotSize * BigInt(lots), decimals)} FXRP)`);

  // Step 1: Pick agent
  let agentVault = args.agent;
  if (!agentVault) {
    const agentList = await am.getAvailableAgentsDetailedList(0, 20);
    // Pick first agent with enough capacity
    for (const a of agentList) {
      if (a.freeCollateralLots >= BigInt(lots) && a.agentVault !== ethers.ZeroAddress) {
        agentVault = a.agentVault;
        break;
      }
    }
    if (!agentVault) throw new Error('No agent with enough free lots found');
  }
  console.log(`  Agent:         ${agentVault}`);

  // Step 2: Reserve collateral
  const fee = await am.collateralReservationFee(lots);
  console.log(`  CRF:           ${ethers.formatEther(fee)} FLR`);
  console.log('');
  console.log('📝 Step 1: Reserving collateral...');
  
  const maxFeeBIPS = parseInt(args.maxFee || '2500'); // 25% max minting fee
  const reserveTx = await am.reserveCollateral(agentVault, lots, maxFeeBIPS, ethers.ZeroAddress, { value: fee });
  console.log(`  TX: ${reserveTx.hash}`);
  const receipt = await reserveTx.wait();
  console.log('  ✅ Reserved');

  // Step 3: Parse CollateralReserved event
  const log = receipt.logs[0];
  const data = log.data.slice(2);
  const chunks = [];
  for (let i = 0; i < data.length; i += 64) chunks.push(data.slice(i, i + 64));

  const valueUBA = Number(BigInt('0x' + chunks[0]));
  const feeUBA = Number(BigInt('0x' + chunks[1]));
  const totalXRP = (valueUBA + feeUBA) / 1e6;
  const lastTimestamp = Number(BigInt('0x' + chunks[4]));
  const paymentRef = chunks[6];

  // Decode payment address string
  const strOffset = Number(BigInt('0x' + chunks[5]));
  const strLenPos = strOffset * 2;
  const strLen = Number(BigInt('0x' + data.slice(strLenPos, strLenPos + 64)));
  const strHex = data.slice(strLenPos + 64, strLenPos + 64 + strLen * 2);
  const paymentAddress = Buffer.from(strHex, 'hex').toString('utf8');

  const reservationId = BigInt(log.topics[3]).toString();

  console.log('');
  console.log('📋 Minting Instructions:');
  console.log(`  Reservation ID: ${reservationId}`);
  console.log(`  Send ${totalXRP} XRP to: ${paymentAddress}`);
  console.log(`  Payment ref: 0x${paymentRef}`);
  console.log(`  Deadline: ${new Date(lastTimestamp * 1000).toISOString()}`);

  // Step 4: Check XRPL balance
  const client = new xrpl.Client(XRPL_WSS);
  await client.connect();

  let xrpBalance;
  try {
    const acctInfo = await client.request({ command: 'account_info', account: xrplAddress });
    xrpBalance = Number(xrpl.dropsToXrp(acctInfo.result.account_data.Balance));
    console.log(`\n  XRPL Balance: ${xrpBalance} XRP`);
    const available = xrpBalance - 1; // 1 XRP base reserve (XRPL reduced from 10)
    console.log(`  Available (minus reserve): ${available.toFixed(6)} XRP`);
    if (available < totalXRP) {
      await client.disconnect();
      throw new Error(`Insufficient XRP. Need ${totalXRP}, have ${available.toFixed(6)} available (after 10 XRP reserve)`);
    }
  } catch (e) {
    if (e.data?.error === 'actNotFound') {
      await client.disconnect();
      throw new Error('XRPL account not activated. Need at least 1 XRP reserve + minting amount');
    }
    if (e.message?.includes('Insufficient')) throw e;
  }

  // Step 5: Send XRP payment
  console.log('');
  console.log('💸 Step 2: Sending XRP payment...');

  const payment = {
    TransactionType: 'Payment',
    Account: xrplAddress,
    Destination: paymentAddress,
    Amount: xrpl.xrpToDrops(totalXRP.toString()),
    Memos: [{
      Memo: {
        MemoData: paymentRef,
        MemoType: Buffer.from('text/plain').toString('hex').toUpperCase(),
      }
    }]
  };

  const prepared = await client.autofill(payment);
  const signed = xrplWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const txResult = result.result.meta?.TransactionResult;
  console.log(`  XRPL TX: ${result.result.hash}`);
  console.log(`  Result: ${txResult}`);

  if (txResult !== 'tesSUCCESS') {
    await client.disconnect();
    throw new Error(`XRPL payment failed: ${txResult}`);
  }

  const remaining = await client.request({ command: 'account_info', account: xrplAddress });
  console.log(`  Remaining XRP: ${xrpl.dropsToXrp(remaining.result.account_data.Balance)}`);
  await client.disconnect();

  // Step 6: Wait for FDC verification and minting
  console.log('');
  console.log('⏳ Step 3: Waiting for FDC verification and minting...');
  console.log('  The agent/executor will submit the FDC proof and execute minting.');
  console.log('  This typically takes 5-20 minutes.');
  console.log('');

  const startBalance = await fxrp.balanceOf(signer.address);
  const expectedIncrease = lotSize * BigInt(lots);
  let minted = false;

  for (let i = 0; i < 40; i++) { // 40 * 30s = 20 min max
    await new Promise(r => setTimeout(r, 30000));
    const bal = await fxrp.balanceOf(signer.address);
    const diff = bal - startBalance;
    if (diff > 0n) {
      console.log(`  ✅ MINTED! +${ethers.formatUnits(diff, decimals)} FXRP`);
      console.log(`  New FXRP balance: ${ethers.formatUnits(bal, decimals)}`);
      minted = true;
      break;
    }
    if (i % 4 === 3) console.log(`  Still waiting... (${(i + 1) * 30}s elapsed)`);
  }

  if (!minted) {
    console.log('');
    console.log('  ⚠️ Minting not yet complete after 20 minutes.');
    console.log('  The XRP payment was successful — FXRP will be minted once FDC proof is submitted.');
    console.log('  You can:');
    console.log('    1. Wait longer — some agents take up to 30 min');
    console.log('    2. Execute via dApp: https://fassets.au.cc/mint');
    console.log('    3. Check balance: node fassets.js info --address ' + signer.address);
  }

  console.log('');
  console.log('═══════════════════════════════');
  console.log('Summary:');
  console.log(`  Reservation: #${reservationId}`);
  console.log(`  XRP Sent: ${totalXRP} to ${paymentAddress}`);
  console.log(`  XRPL TX: ${result.result.hash}`);
  console.log(`  Flare TX: ${reserveTx.hash}`);
  console.log(`  Minted: ${minted ? '✅' : '⏳ Pending'}`);
}

async function redeem(args) {
  if (!args.xrplAddress) throw new Error('--xrpl-address required');
  const lots = parseInt(args.lots || '1');
  if (lots < 1) throw new Error('--lots must be >= 1');

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

  const remaining = await fxrp.balanceOf(signer.address);
  console.log(`  FXRP remaining: ${ethers.formatUnits(remaining, decimals)}`);
}

async function status(args) {
  if (!args.xrplAddress) throw new Error('--xrpl-address required');

  let xrpl;
  try { xrpl = require('xrpl'); } catch (e) {
    throw new Error('Missing dependency: xrpl. Run: npm install xrpl');
  }

  const client = new xrpl.Client(XRPL_WSS);
  await client.connect();

  console.log('📊 XRPL Account Status');
  console.log('═══════════════════════════════');
  console.log(`  Address: ${args.xrplAddress}`);

  try {
    const info = await client.request({ command: 'account_info', account: args.xrplAddress });
    const balance = xrpl.dropsToXrp(info.result.account_data.Balance);
    console.log(`  Balance: ${balance} XRP`);
    console.log(`  Status:  ✅ Active`);

    const txs = await client.request({ command: 'account_tx', account: args.xrplAddress, limit: 5 });
    if (txs.result.transactions?.length) {
      console.log('');
      console.log('  Recent Transactions:');
      for (const t of txs.result.transactions) {
        const tx = t.tx_json || t.tx;
        const delivered = t.meta?.delivered_amount;
        const amount = typeof delivered === 'string' ? xrpl.dropsToXrp(delivered) + ' XRP' : 'token';
        const dir = tx.Destination === args.xrplAddress ? '📥 IN' : '📤 OUT';
        console.log(`    ${dir} ${amount} | ${tx.TransactionType} | ${t.validated ? '✅' : '⏳'}`);
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

  // Also show Flare FXRP balance if address provided
  if (args.address) {
    const provider = new ethers.JsonRpcProvider(RPC);
    const fxrp = new ethers.Contract(FXRP, FXRP_ABI, provider);
    const bal = await fxrp.balanceOf(args.address);
    console.log(`\n  Flare FXRP: ${ethers.formatUnits(bal, 6)}`);
  }

  await client.disconnect();
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._cmd || 'info';

  switch (cmd) {
    case 'info':    return info(args);
    case 'agents':  return agents(args);
    case 'mint':    return mint(args);
    case 'redeem':  return redeem(args);
    case 'status':  return status(args);
    default:
      console.log('FAssets Mint & Redeem');
      console.log('═══════════════════════════════');
      console.log('');
      console.log('Usage: node fassets.js <command> [options]');
      console.log('');
      console.log('Commands:');
      console.log('  info                              Show redemption parameters');
      console.log('  agents                            List available minting agents');
      console.log('  mint --lots N                     Mint FXRP (send XRP, receive FXRP)');
      console.log('  redeem --lots N --xrpl-address r  Redeem FXRP to XRP');
      console.log('  status --xrpl-address r           Check XRPL balance & history');
      console.log('');
      console.log('Mint Options:');
      console.log('  --lots <N>           Number of lots (1 lot = 10 FXRP)');
      console.log('  --keystore <path>    Flare wallet keystore');
      console.log('  --xrpl-key <path>    XRPL wallet JSON (from create-xrpl-wallet.js)');
      console.log('  --agent <0x...>      Specific agent vault (auto-selects if omitted)');
      console.log('  --max-fee <BIPS>     Max minting fee in BIPS (default: 2500 = 25%)');
      console.log('');
      console.log('Redeem Options:');
      console.log('  --lots <N>           Number of lots (1 lot = 10 FXRP)');
      console.log('  --xrpl-address <r..> Destination XRPL address');
      console.log('  --keystore <path>    Flare wallet keystore');
      console.log('');
      console.log('Flow:');
      console.log('  1. Create XRPL wallet:  node create-xrpl-wallet.js --save wallet.json');
      console.log('  2. Fund with ≥10 XRP to activate + amount to mint');
      console.log('  3. Mint:   node fassets.js mint --lots 1');
      console.log('  4. Redeem: node fassets.js redeem --lots 1 --xrpl-address rXXX...');
  }
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
