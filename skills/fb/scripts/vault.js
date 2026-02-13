#!/usr/bin/env node
/**
 * FlareBank Vault Script
 * Mint, burn, claim, compound BANK tokens
 */

const { ethers } = require('ethers');
const fs = require('fs');

const FLARE_RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';
const FB_MAIN = '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059';
const WALLET_PATH = process.env.WALLET_PATH || process.env.AGENT_KEYSTORE || './keystore.json';

const FB_ABI = [
  'function buyPrice() view returns (uint256)',
  'function sellPrice() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function buy(address _referredBy) payable returns (uint256)',
  'function sell(uint256 _amountOfTokens)',
  'function withdraw()',
  'function reinvest()',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

async function getProvider() {
  return new ethers.JsonRpcProvider(FLARE_RPC);
}

async function getSigner() {
  const provider = await getProvider();
  const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
  return new ethers.Wallet(walletData.privateKey, provider);
}

async function status(address) {
  const provider = await getProvider();
  const fb = new ethers.Contract(FB_MAIN, FB_ABI, provider);
  
  const [buyPrice, sellPrice, totalSupply, balance, flrBalance] = await Promise.all([
    fb.buyPrice(),
    fb.sellPrice(),
    fb.totalSupply(),
    fb.balanceOf(address),
    provider.getBalance(address),
  ]);
  
  console.log('📊 FlareBank Vault Status\n');
  console.log('Address:', address);
  console.log('BANK Balance:', ethers.formatEther(balance), 'BANK');
  console.log('FLR Balance:', ethers.formatEther(flrBalance), 'FLR');
  // Burn price = buyPrice * 0.90 (10% exit fee)
  const burnPrice = (buyPrice * 90n) / 100n;
  
  console.log('\nProtocol:');
  console.log('  Total Supply:', ethers.formatEther(totalSupply), 'BANK');
  console.log('  Buy Price:', ethers.formatEther(buyPrice), 'FLR/BANK');
  console.log('  Burn Price:', ethers.formatEther(burnPrice), 'FLR/BANK (after 10% fee)');
  
  return { buyPrice, burnPrice, totalSupply, balance, flrBalance };
}

async function mint(amount) {
  const signer = await getSigner();
  const fb = new ethers.Contract(FB_MAIN, FB_ABI, signer);
  
  const buyPrice = await fb.buyPrice();
  const bankBefore = await fb.balanceOf(signer.address);
  
  // Calculate FLR needed (add 1% buffer)
  const amountBN = ethers.parseEther(amount.toString());
  const flrNeeded = (amountBN * buyPrice / ethers.parseEther('1')) * 101n / 100n;
  
  console.log('🔄 Minting BANK...');
  console.log('  Target:', amount, 'BANK');
  console.log('  Sending:', ethers.formatEther(flrNeeded), 'FLR');
  
  const tx = await fb['buy(address)'](ethers.ZeroAddress, { 
    value: flrNeeded,
    gasLimit: 500000
  });
  console.log('  Tx:', tx.hash);
  
  const receipt = await tx.wait();
  const bankAfter = await fb.balanceOf(signer.address);
  const minted = bankAfter - bankBefore;
  
  console.log('\n✅ Minted:', ethers.formatEther(minted), 'BANK');
  console.log('  Block:', receipt.blockNumber);
  
  return { tx: receipt.hash, minted };
}

async function burn(amount) {
  const signer = await getSigner();
  const fb = new ethers.Contract(FB_MAIN, FB_ABI, signer);
  
  const bankBefore = await fb.balanceOf(signer.address);
  const flrBefore = await signer.provider.getBalance(signer.address);
  
  const amountBN = ethers.parseEther(amount.toString());
  
  console.log('🔥 Burning BANK...');
  console.log('  Amount:', amount, 'BANK');
  
  const tx = await fb.sell(amountBN, { gasLimit: 500000 });
  console.log('  Tx:', tx.hash);
  
  const receipt = await tx.wait();
  const bankAfter = await fb.balanceOf(signer.address);
  const flrAfter = await signer.provider.getBalance(signer.address);
  
  const gasCost = receipt.gasUsed * receipt.gasPrice;
  const flrReceived = flrAfter - flrBefore + gasCost;
  
  console.log('\n✅ Burned:', ethers.formatEther(bankBefore - bankAfter), 'BANK');
  console.log('  Received:', ethers.formatEther(flrReceived), 'FLR');
  console.log('  Block:', receipt.blockNumber);
  
  return { tx: receipt.hash, burned: bankBefore - bankAfter, received: flrReceived };
}

async function claim() {
  const signer = await getSigner();
  const fb = new ethers.Contract(FB_MAIN, FB_ABI, signer);
  
  const flrBefore = await signer.provider.getBalance(signer.address);
  
  console.log('💰 Claiming dividends...');
  
  const tx = await fb.withdraw({ gasLimit: 500000 });
  console.log('  Tx:', tx.hash);
  
  const receipt = await tx.wait();
  const flrAfter = await signer.provider.getBalance(signer.address);
  
  const gasCost = receipt.gasUsed * receipt.gasPrice;
  const claimed = flrAfter - flrBefore + gasCost;
  
  if (claimed > 0n) {
    console.log('\n✅ Claimed:', ethers.formatEther(claimed), 'FLR');
  } else {
    console.log('\n⚠️ No dividends to claim');
  }
  console.log('  Block:', receipt.blockNumber);
  
  return { tx: receipt.hash, claimed };
}

async function compound() {
  const signer = await getSigner();
  const fb = new ethers.Contract(FB_MAIN, FB_ABI, signer);
  
  const bankBefore = await fb.balanceOf(signer.address);
  
  console.log('🔄 Compounding dividends...');
  
  const tx = await fb.reinvest({ gasLimit: 500000 });
  console.log('  Tx:', tx.hash);
  
  const receipt = await tx.wait();
  const bankAfter = await fb.balanceOf(signer.address);
  const compounded = bankAfter - bankBefore;
  
  if (compounded > 0n) {
    console.log('\n✅ Compounded:', ethers.formatEther(compounded), 'BANK');
  } else {
    console.log('\n⚠️ No dividends to compound');
  }
  console.log('  Block:', receipt.blockNumber);
  
  return { tx: receipt.hash, compounded };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  if (!command || command === 'help') {
    console.log(`
FlareBank Vault CLI

Commands:
  status              Show balances and prices
  mint --amount <n>   Mint n BANK tokens
  burn --amount <n>   Burn n BANK tokens
  claim               Claim pending dividends
  compound            Reinvest dividends into BANK

Options:
  --amount <n>        Amount of BANK tokens
  --wallet <path>     Path to wallet JSON (default: clawd-wallet.json)
`);
    return;
  }
  
  // Get wallet address for status
  let address;
  try {
    const walletData = JSON.parse(fs.readFileSync(WALLET_PATH));
    address = walletData.address;
  } catch(e) {
    address = getArg('address') || process.env.AGENT_WALLET || '0xYOUR_WALLET_ADDRESS';
  }
  
  switch (command) {
    case 'status':
      await status(address);
      break;
    case 'mint':
      const mintAmount = getArg('amount');
      if (!mintAmount) {
        console.error('Error: --amount required');
        process.exit(1);
      }
      await mint(parseFloat(mintAmount));
      break;
    case 'burn':
      const burnAmount = getArg('amount');
      if (!burnAmount) {
        console.error('Error: --amount required');
        process.exit(1);
      }
      await burn(parseFloat(burnAmount));
      break;
    case 'claim':
      await claim();
      break;
    case 'compound':
      await compound();
      break;
    default:
      console.error('Unknown command:', command);
      process.exit(1);
  }
}

main().catch(console.error);

module.exports = { status, mint, burn, claim, compound };
