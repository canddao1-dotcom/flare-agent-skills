#!/usr/bin/env node
/**
 * Enosys Loans (CDP) Skill
 * 
 * Interact with Enosys CDP protocol - Liquity V2 fork on Flare
 */

const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
const DEFAULT_KEYSTORE = process.env.AGENT_KEYSTORE || './keystore.json';

// Contract Addresses
const CONTRACTS = {
  cdp: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F',
  
  // FXRP Branch
  fxrp: {
    stabilityPool: '0x2c817F7159c08d94f09764086330c96Bb3265A2f',
    troveManager: '0xc46e7d0538494FEb82b460b9723dAba0508C8Fb1',
    borrowerOps: '0x18139E09Fb9a683Dd2c2df5D0edAD942c19CE912',
    collToken: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
    collDecimals: 6,
    collSymbol: 'FXRP',
  },
  
  // WFLR Branch
  wflr: {
    stabilityPool: '0x0Dd6daab4cB9A0ba6707Cf59DBfbc28cc33CA24A',
    troveManager: '0xB6cB0c5301D4E6e227Ba490cee7b92EB954ac06D',
    borrowerOps: '0x19b154D5d20126a77309ae01931645a135E4E252',
    collToken: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
    collDecimals: 18,
    collSymbol: 'WFLR',
  },
};

// ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const STABILITY_POOL_ABI = [
  'function getTotalBoldDeposits() view returns (uint256)',
  'function getCollBalance() view returns (uint256)',
  'function getCompoundedBoldDeposit(address) view returns (uint256)',
  'function getDepositorYieldGain(address) view returns (uint256)',
  'function getDepositorCollGain(address) view returns (uint256)',
  'function provideToSP(uint256 _topUp, bool _doClaim)',
  'function withdrawFromSP(uint256 _amount, bool _doClaim)',
];

const TROVE_MANAGER_ABI = [
  'function getTroveIdsCount() view returns (uint256)',
  'function getEntireSystemColl() view returns (uint256)',
  'function getEntireSystemDebt() view returns (uint256)',
  'function MCR() view returns (uint256)',
  'function CCR() view returns (uint256)',
];

async function getProvider() {
  return new ethers.JsonRpcProvider(FLARE_RPC);
}

async function getSigner(keystorePath) {
  const provider = await getProvider();
  const walletData = JSON.parse(fs.readFileSync(keystorePath || DEFAULT_KEYSTORE));
  return new ethers.Wallet(walletData.privateKey, provider);
}

// ============ STATUS ============
async function status() {
  const provider = await getProvider();
  
  const cdp = new ethers.Contract(CONTRACTS.cdp, ERC20_ABI, provider);
  const fxrpSP = new ethers.Contract(CONTRACTS.fxrp.stabilityPool, STABILITY_POOL_ABI, provider);
  const wflrSP = new ethers.Contract(CONTRACTS.wflr.stabilityPool, STABILITY_POOL_ABI, provider);
  const fxrpTM = new ethers.Contract(CONTRACTS.fxrp.troveManager, TROVE_MANAGER_ABI, provider);
  const wflrTM = new ethers.Contract(CONTRACTS.wflr.troveManager, TROVE_MANAGER_ABI, provider);
  
  const [
    totalSupply,
    fxrpDeposits,
    wflrDeposits,
    fxrpTroves,
    wflrTroves,
  ] = await Promise.all([
    cdp.totalSupply(),
    fxrpSP.getTotalBoldDeposits(),
    wflrSP.getTotalBoldDeposits(),
    fxrpTM.getTroveIdsCount(),
    wflrTM.getTroveIdsCount(),
  ]);
  
  console.log('📊 ENOSYS LOANS (CDP) STATUS\n');
  
  console.log('=== CDP Token ===');
  console.log(`Total Supply: ${Number(ethers.formatUnits(totalSupply, 18)).toLocaleString()} CDP`);
  
  console.log('\n=== Stability Pools (Earn) ===');
  console.log(`FXRP Pool: ${Number(ethers.formatUnits(fxrpDeposits, 18)).toLocaleString()} CDP`);
  console.log(`WFLR Pool: ${Number(ethers.formatUnits(wflrDeposits, 18)).toLocaleString()} CDP`);
  console.log(`Total: ${Number(ethers.formatUnits(fxrpDeposits + wflrDeposits, 18)).toLocaleString()} CDP`);
  
  console.log('\n=== Active Troves ===');
  console.log(`FXRP Branch: ${fxrpTroves.toString()} troves`);
  console.log(`WFLR Branch: ${wflrTroves.toString()} troves`);
  
  console.log('\n=== Parameters ===');
  console.log('MCR: 110% | CCR: 150%');
}

// ============ BALANCE ============
async function balance(address) {
  const provider = await getProvider();
  
  if (!address) {
    const walletData = JSON.parse(fs.readFileSync(DEFAULT_KEYSTORE));
    const wallet = new ethers.Wallet(walletData.privateKey);
    address = wallet.address;
  }
  
  const cdp = new ethers.Contract(CONTRACTS.cdp, ERC20_ABI, provider);
  const fxrpSP = new ethers.Contract(CONTRACTS.fxrp.stabilityPool, STABILITY_POOL_ABI, provider);
  const wflrSP = new ethers.Contract(CONTRACTS.wflr.stabilityPool, STABILITY_POOL_ABI, provider);
  
  const [
    cdpBalance,
    fxrpDeposit,
    fxrpYield,
    fxrpColl,
    wflrDeposit,
    wflrYield,
    wflrColl,
  ] = await Promise.all([
    cdp.balanceOf(address),
    fxrpSP.getCompoundedBoldDeposit(address),
    fxrpSP.getDepositorYieldGain(address),
    fxrpSP.getDepositorCollGain(address),
    wflrSP.getCompoundedBoldDeposit(address),
    wflrSP.getDepositorYieldGain(address),
    wflrSP.getDepositorCollGain(address),
  ]);
  
  console.log(`📊 CDP BALANCE: ${address.slice(0,10)}...`);
  console.log('');
  console.log(`CDP Wallet Balance: ${ethers.formatUnits(cdpBalance, 18)} CDP`);
  
  console.log('\n=== FXRP Stability Pool ===');
  console.log(`Deposited: ${ethers.formatUnits(fxrpDeposit, 18)} CDP`);
  console.log(`Pending Yield: ${ethers.formatUnits(fxrpYield, 18)} CDP`);
  console.log(`Pending Coll: ${ethers.formatUnits(fxrpColl, 6)} FXRP`);
  
  console.log('\n=== WFLR Stability Pool ===');
  console.log(`Deposited: ${ethers.formatUnits(wflrDeposit, 18)} CDP`);
  console.log(`Pending Yield: ${ethers.formatUnits(wflrYield, 18)} CDP`);
  console.log(`Pending Coll: ${ethers.formatUnits(wflrColl, 18)} WFLR`);
}

// ============ POOLS ============
async function pools() {
  const provider = await getProvider();
  
  const fxrpSP = new ethers.Contract(CONTRACTS.fxrp.stabilityPool, STABILITY_POOL_ABI, provider);
  const wflrSP = new ethers.Contract(CONTRACTS.wflr.stabilityPool, STABILITY_POOL_ABI, provider);
  
  const [fxrpDeposits, fxrpColl, wflrDeposits, wflrColl] = await Promise.all([
    fxrpSP.getTotalBoldDeposits(),
    fxrpSP.getCollBalance(),
    wflrSP.getTotalBoldDeposits(),
    wflrSP.getCollBalance(),
  ]);
  
  console.log('📊 STABILITY POOLS\n');
  
  console.log('=== FXRP Pool ===');
  console.log(`Address: ${CONTRACTS.fxrp.stabilityPool}`);
  console.log(`Total CDP: ${Number(ethers.formatUnits(fxrpDeposits, 18)).toLocaleString()}`);
  console.log(`Coll Balance: ${ethers.formatUnits(fxrpColl, 6)} FXRP`);
  
  console.log('\n=== WFLR Pool ===');
  console.log(`Address: ${CONTRACTS.wflr.stabilityPool}`);
  console.log(`Total CDP: ${Number(ethers.formatUnits(wflrDeposits, 18)).toLocaleString()}`);
  console.log(`Coll Balance: ${ethers.formatUnits(wflrColl, 18)} WFLR`);
}

// ============ DEPOSIT ============
async function deposit(amount, pool, keystorePath) {
  pool = pool.toLowerCase();
  if (!['fxrp', 'wflr'].includes(pool)) {
    console.error('❌ Invalid pool. Use: fxrp or wflr');
    process.exit(1);
  }
  
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  const poolConfig = CONTRACTS[pool];
  
  const cdp = new ethers.Contract(CONTRACTS.cdp, ERC20_ABI, signer);
  const sp = new ethers.Contract(poolConfig.stabilityPool, STABILITY_POOL_ABI, signer);
  
  const amountWei = ethers.parseUnits(amount.toString(), 18);
  
  // Check balance
  const balance = await cdp.balanceOf(address);
  if (balance < amountWei) {
    console.error(`❌ Insufficient CDP. Have: ${ethers.formatUnits(balance, 18)}, Need: ${amount}`);
    process.exit(1);
  }
  
  // Get deposit before
  const depositBefore = await sp.getCompoundedBoldDeposit(address);
  
  console.log(`📥 CDP DEPOSIT TO ${pool.toUpperCase()} POOL`);
  console.log(`   Amount: ${amount} CDP`);
  console.log(`   Pool: ${poolConfig.stabilityPool}`);
  console.log(`   Wallet: ${address}`);
  console.log('');
  
  // Check and approve if needed
  const allowance = await cdp.allowance(address, poolConfig.stabilityPool);
  if (allowance < amountWei) {
    console.log('📝 Approving CDP...');
    const approveTx = await cdp.approve(poolConfig.stabilityPool, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Execute deposit (provideToSP)
  console.log('🔄 Depositing...');
  try {
    const tx = await sp.provideToSP(amountWei, false); // false = don't claim rewards yet
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    
    // Check deposit after
    const depositAfter = await sp.getCompoundedBoldDeposit(address);
    
    console.log('');
    console.log('✅ Deposit Complete!');
    console.log(`   Deposited: ${amount} CDP`);
    console.log(`   New Balance: ${ethers.formatUnits(depositAfter, 18)} CDP`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Deposit failed:', err.message);
    if (err.data) console.error('   Data:', err.data);
    process.exit(1);
  }
}

// ============ WITHDRAW ============
async function withdraw(amount, pool, keystorePath) {
  pool = pool.toLowerCase();
  if (!['fxrp', 'wflr'].includes(pool)) {
    console.error('❌ Invalid pool. Use: fxrp or wflr');
    process.exit(1);
  }
  
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  const poolConfig = CONTRACTS[pool];
  
  const sp = new ethers.Contract(poolConfig.stabilityPool, STABILITY_POOL_ABI, signer);
  const cdp = new ethers.Contract(CONTRACTS.cdp, ERC20_ABI, signer.provider);
  
  const amountWei = ethers.parseUnits(amount.toString(), 18);
  
  // Check deposit
  const currentDeposit = await sp.getCompoundedBoldDeposit(address);
  if (currentDeposit < amountWei) {
    console.error(`❌ Insufficient deposit. Have: ${ethers.formatUnits(currentDeposit, 18)}, Need: ${amount}`);
    process.exit(1);
  }
  
  // Get CDP balance before
  const cdpBefore = await cdp.balanceOf(address);
  
  console.log(`📤 CDP WITHDRAW FROM ${pool.toUpperCase()} POOL`);
  console.log(`   Amount: ${amount} CDP`);
  console.log(`   Wallet: ${address}`);
  console.log('');
  
  // Execute withdraw
  console.log('🔄 Withdrawing...');
  try {
    const tx = await sp.withdrawFromSP(amountWei, true); // true = claim rewards too
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    
    // Check CDP balance after
    const cdpAfter = await cdp.balanceOf(address);
    const cdpReceived = cdpAfter - cdpBefore;
    
    console.log('');
    console.log('✅ Withdraw Complete!');
    console.log(`   Received: ${ethers.formatUnits(cdpReceived, 18)} CDP`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Withdraw failed:', err.message);
    process.exit(1);
  }
}

// ============ CLAIM ============
async function claim(pool, keystorePath) {
  pool = pool.toLowerCase();
  if (!['fxrp', 'wflr'].includes(pool)) {
    console.error('❌ Invalid pool. Use: fxrp or wflr');
    process.exit(1);
  }
  
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  const poolConfig = CONTRACTS[pool];
  
  const sp = new ethers.Contract(poolConfig.stabilityPool, STABILITY_POOL_ABI, signer);
  
  // Check pending rewards
  const [yieldGain, collGain] = await Promise.all([
    sp.getDepositorYieldGain(address),
    sp.getDepositorCollGain(address),
  ]);
  
  console.log(`🎁 CLAIM FROM ${pool.toUpperCase()} POOL`);
  console.log(`   Pending Yield: ${ethers.formatUnits(yieldGain, 18)} CDP`);
  console.log(`   Pending Coll: ${ethers.formatUnits(collGain, poolConfig.collDecimals)} ${poolConfig.collSymbol}`);
  console.log('');
  
  if (yieldGain === 0n && collGain === 0n) {
    console.log('ℹ️ Nothing to claim');
    return;
  }
  
  // Withdraw 0 with claim = true to just claim rewards
  console.log('🔄 Claiming...');
  try {
    const tx = await sp.withdrawFromSP(0n, true);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log('');
    console.log('✅ Claim Complete!');
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Claim failed:', err.message);
    process.exit(1);
  }
}

// ============ CLI ============
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  const keystorePath = getArg('keystore') || DEFAULT_KEYSTORE;
  
  if (!command || command === '--help') {
    console.log(`
Enosys Loans (CDP) CLI

Usage: node cdp.js <command> [options]

Commands:
  status              Protocol stats, pool TVL
  balance [address]   Check CDP balance and SP deposits
  pools               Stability pool details
  deposit <amt> <pool> Deposit CDP to earn (fxrp/wflr)
  withdraw <amt> <pool> Withdraw from pool
  claim <pool>        Claim yield + collateral

Pools: fxrp, wflr

Options:
  --keystore <path>   Wallet keystore path

Examples:
  node cdp.js status
  node cdp.js deposit 100 fxrp
  node cdp.js withdraw 50 wflr
  node cdp.js claim fxrp
`);
    return;
  }
  
  switch (command) {
    case 'status':
      await status();
      break;
      
    case 'balance':
      await balance(args[1]);
      break;
      
    case 'pools':
      await pools();
      break;
      
    case 'deposit':
      if (!args[1] || !args[2]) {
        console.error('Usage: deposit <amount> <pool>');
        process.exit(1);
      }
      await deposit(args[1], args[2], keystorePath);
      break;
      
    case 'withdraw':
      if (!args[1] || !args[2]) {
        console.error('Usage: withdraw <amount> <pool>');
        process.exit(1);
      }
      await withdraw(args[1], args[2], keystorePath);
      break;
      
    case 'claim':
      if (!args[1]) {
        console.error('Usage: claim <pool>');
        process.exit(1);
      }
      await claim(args[1], keystorePath);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(console.error);
