#!/usr/bin/env node
/**
 * Upshift Finance Vault Skill
 * 
 * Interact with Upshift yield vaults on Flare
 */

const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
const DEFAULT_KEYSTORE = process.env.AGENT_KEYSTORE || './keystore.json';

// Upshift FXRP Vault Contracts
const CONTRACTS = {
  vault: '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28',
  earnXRP: '0xe533e447fd7720b2f8654da2b1953efa06b60bfa',
  fxrp: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
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

const VAULT_ABI = [
  // Deposits
  'function deposit(address token, uint256 amount, address account)',
  
  // Redemptions
  'function instantRedeem(uint256 wNLPAmount, address to) returns (uint256)',
  'function requestRedeem(uint256 _shares, address _token)',
  
  // View - correct method for total assets
  'function getTotalAssets() view returns (uint256)',
  'function owner() view returns (address)',
  'function asset() view returns (address)',
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
  
  const fxrp = new ethers.Contract(CONTRACTS.fxrp, ERC20_ABI, provider);
  const vault = new ethers.Contract(CONTRACTS.vault, VAULT_ABI, provider);
  const earnXRP = new ethers.Contract(CONTRACTS.earnXRP, ERC20_ABI, provider);
  
  const [totalAssets, vaultReserve, earnSupply] = await Promise.all([
    vault.getTotalAssets(),
    fxrp.balanceOf(CONTRACTS.vault),
    earnXRP.totalSupply(),
  ]);
  
  const sharePrice = Number(totalAssets) / Number(earnSupply);
  const fxrpPrice = 1.80; // Approximate FXRP price
  const tvlUsd = Number(ethers.formatUnits(totalAssets, 6)) * fxrpPrice;
  const deployedToStrategies = Number(totalAssets) - Number(vaultReserve);
  const utilization = (deployedToStrategies / Number(totalAssets)) * 100;
  
  console.log('📊 UPSHIFT FXRP VAULT STATUS');
  console.log('');
  console.log('=== TVL ===');
  console.log(`Total Assets: ${Number(ethers.formatUnits(totalAssets, 6)).toLocaleString('en-US', {maximumFractionDigits: 2})} FXRP`);
  console.log(`USD Value: ~$${(tvlUsd / 1e6).toFixed(2)}M`);
  console.log(`Vault Reserve: ${Number(ethers.formatUnits(vaultReserve, 6)).toLocaleString('en-US', {maximumFractionDigits: 2})} FXRP`);
  console.log(`Deployed to Strategies: ${(deployedToStrategies / 1e6).toLocaleString('en-US', {maximumFractionDigits: 2})} FXRP`);
  console.log(`Utilization: ${utilization.toFixed(1)}%`);
  console.log('');
  console.log('=== Shares ===');
  console.log(`earnXRP Supply: ${Number(ethers.formatUnits(earnSupply, 6)).toLocaleString('en-US', {maximumFractionDigits: 2})}`);
  console.log(`Share Price: ${sharePrice.toFixed(6)} FXRP per earnXRP`);
  console.log('');
  console.log('=== Contracts ===');
  console.log(`Vault: ${CONTRACTS.vault}`);
  console.log(`earnXRP: ${CONTRACTS.earnXRP}`);
}

// ============ BALANCE ============
async function balance(address) {
  const provider = await getProvider();
  
  if (!address) {
    const walletData = JSON.parse(fs.readFileSync(DEFAULT_KEYSTORE));
    const wallet = new ethers.Wallet(walletData.privateKey);
    address = wallet.address;
  }
  
  const fxrp = new ethers.Contract(CONTRACTS.fxrp, ERC20_ABI, provider);
  const vault = new ethers.Contract(CONTRACTS.vault, VAULT_ABI, provider);
  const earnXRP = new ethers.Contract(CONTRACTS.earnXRP, ERC20_ABI, provider);
  
  const [fxrpBal, earnBal, totalAssets, earnSupply] = await Promise.all([
    fxrp.balanceOf(address),
    earnXRP.balanceOf(address),
    vault.getTotalAssets(),
    earnXRP.totalSupply(),
  ]);
  
  const sharePrice = Number(totalAssets) / Number(earnSupply);
  const earnValueFxrp = Number(earnBal) * sharePrice / 1e6;
  const fxrpPrice = 1.80;
  
  console.log(`📊 UPSHIFT BALANCE: ${address.slice(0,8)}...`);
  console.log('');
  console.log(`FXRP Balance: ${ethers.formatUnits(fxrpBal, 6)} FXRP`);
  console.log(`earnXRP Balance: ${ethers.formatUnits(earnBal, 6)} earnXRP`);
  console.log(`earnXRP Value: ${earnValueFxrp.toFixed(6)} FXRP (~$${(earnValueFxrp * fxrpPrice).toFixed(2)})`);
}

// ============ DEPOSIT ============
async function deposit(amount, keystorePath) {
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  
  const fxrp = new ethers.Contract(CONTRACTS.fxrp, ERC20_ABI, signer);
  const vault = new ethers.Contract(CONTRACTS.vault, VAULT_ABI, signer);
  const earnXRP = new ethers.Contract(CONTRACTS.earnXRP, ERC20_ABI, signer.provider);
  
  const amountWei = ethers.parseUnits(amount.toString(), 6);
  
  // Check balance
  const balance = await fxrp.balanceOf(address);
  if (balance < amountWei) {
    console.error(`❌ Insufficient FXRP. Have: ${ethers.formatUnits(balance, 6)}, Need: ${amount}`);
    process.exit(1);
  }
  
  // Get earnXRP balance before
  const earnBefore = await earnXRP.balanceOf(address);
  
  console.log(`📥 UPSHIFT DEPOSIT`);
  console.log(`   Amount: ${amount} FXRP`);
  console.log(`   Wallet: ${address}`);
  console.log('');
  
  // Check and approve if needed
  const allowance = await fxrp.allowance(address, CONTRACTS.vault);
  if (allowance < amountWei) {
    console.log('📝 Approving FXRP...');
    const approveTx = await fxrp.approve(CONTRACTS.vault, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Execute deposit
  console.log('🔄 Depositing...');
  try {
    const tx = await vault.deposit(CONTRACTS.fxrp, amountWei, address);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    
    // Check earnXRP balance after
    const earnAfter = await earnXRP.balanceOf(address);
    const earnReceived = earnAfter - earnBefore;
    
    console.log('');
    console.log('✅ Deposit Complete!');
    console.log(`   Deposited: ${amount} FXRP`);
    console.log(`   Received: ${ethers.formatUnits(earnReceived, 6)} earnXRP`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Deposit failed:', err.message);
    if (err.data) console.error('   Data:', err.data);
    process.exit(1);
  }
}

// ============ INSTANT REDEEM ============
async function redeem(shares, keystorePath) {
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  
  const vault = new ethers.Contract(CONTRACTS.vault, VAULT_ABI, signer);
  const earnXRP = new ethers.Contract(CONTRACTS.earnXRP, ERC20_ABI, signer);
  const fxrp = new ethers.Contract(CONTRACTS.fxrp, ERC20_ABI, signer.provider);
  
  const sharesWei = ethers.parseUnits(shares.toString(), 6);
  
  // Check balance
  const balance = await earnXRP.balanceOf(address);
  if (balance < sharesWei) {
    console.error(`❌ Insufficient earnXRP. Have: ${ethers.formatUnits(balance, 6)}, Need: ${shares}`);
    process.exit(1);
  }
  
  // Get FXRP balance before
  const fxrpBefore = await fxrp.balanceOf(address);
  
  console.log(`📤 UPSHIFT INSTANT REDEEM`);
  console.log(`   Shares: ${shares} earnXRP`);
  console.log(`   Wallet: ${address}`);
  console.log('');
  
  // Check if earnXRP needs approval for vault
  const allowance = await earnXRP.allowance(address, CONTRACTS.vault);
  if (allowance < sharesWei) {
    console.log('📝 Approving earnXRP...');
    const approveTx = await earnXRP.approve(CONTRACTS.vault, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Execute redeem
  console.log('🔄 Redeeming...');
  try {
    const tx = await vault.instantRedeem(sharesWei, address);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    
    // Check FXRP balance after
    const fxrpAfter = await fxrp.balanceOf(address);
    const fxrpReceived = fxrpAfter - fxrpBefore;
    
    console.log('');
    console.log('✅ Redeem Complete!');
    console.log(`   Redeemed: ${shares} earnXRP`);
    console.log(`   Received: ${ethers.formatUnits(fxrpReceived, 6)} FXRP`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Redeem failed:', err.message);
    if (err.data) console.error('   Data:', err.data);
    process.exit(1);
  }
}

// ============ REQUEST REDEEM ============
async function requestRedeem(shares, keystorePath) {
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  
  const vault = new ethers.Contract(CONTRACTS.vault, VAULT_ABI, signer);
  const earnXRP = new ethers.Contract(CONTRACTS.earnXRP, ERC20_ABI, signer);
  
  const sharesWei = ethers.parseUnits(shares.toString(), 6);
  
  // Check balance
  const balance = await earnXRP.balanceOf(address);
  if (balance < sharesWei) {
    console.error(`❌ Insufficient earnXRP. Have: ${ethers.formatUnits(balance, 6)}, Need: ${shares}`);
    process.exit(1);
  }
  
  console.log(`📤 UPSHIFT REQUEST REDEEM`);
  console.log(`   Shares: ${shares} earnXRP`);
  console.log(`   Wallet: ${address}`);
  console.log('');
  
  // Execute request
  console.log('🔄 Requesting redemption...');
  try {
    const tx = await vault.requestRedeem(sharesWei, CONTRACTS.fxrp);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log('');
    console.log('✅ Redemption Requested!');
    console.log(`   Shares: ${shares} earnXRP`);
    console.log(`   Status: Queued for processing`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Request failed:', err.message);
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
Upshift Finance Vault CLI

Usage: node upshift.js <command> [options]

Commands:
  status              Vault TVL, share price
  balance [address]   Check earnXRP balance
  deposit <amount>    Deposit FXRP to vault
  redeem <shares>     Instant redeem earnXRP
  request <shares>    Request queued redemption

Options:
  --keystore <path>   Wallet keystore path

Examples:
  node upshift.js status
  node upshift.js deposit 100
  node upshift.js redeem 50
  node upshift.js balance 0x123...
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
      
    case 'deposit':
      if (!args[1]) {
        console.error('Usage: deposit <amount>');
        process.exit(1);
      }
      await deposit(args[1], keystorePath);
      break;
      
    case 'redeem':
      if (!args[1]) {
        console.error('Usage: redeem <shares>');
        process.exit(1);
      }
      await redeem(args[1], keystorePath);
      break;
      
    case 'request':
      if (!args[1]) {
        console.error('Usage: request <shares>');
        process.exit(1);
      }
      await requestRedeem(args[1], keystorePath);
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(console.error);
