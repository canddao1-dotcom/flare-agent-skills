#!/usr/bin/env node
/**
 * Blazeswap V2 Swap Script (ATOMIC via Router)
 * 
 * Uses Blazeswap router for atomic swaps (MEV-safe)
 * 
 * Usage:
 *   node swap-blazeswap.js quote --from WFLR --to FXRP --amount 100
 *   node swap-blazeswap.js swap --keystore <path> --from WFLR --to FXRP --amount 100 --slippage 1
 */

const { ethers } = require('ethers');
const fs = require('fs');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

// Blazeswap Router (atomic swaps!)
const BLAZESWAP_ROUTER = '0xe3a1b355ca63abcbc9589334b5e609583c7baa06';
const BLAZESWAP_FACTORY = '0x440602f459D7Dd500a74528003e6A20A46d6e2A6';

// Known tokens with decimals
const TOKENS = {
  WFLR:  { addr: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  sFLR:  { addr: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
  rFLR:  { addr: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e', decimals: 18 },
  FXRP:  { addr: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', decimals: 6 },
  stXRP: { addr: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', decimals: 6 },
  USDT0: { addr: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
  USDCe: { addr: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', decimals: 6 },
  CDP:   { addr: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F', decimals: 18 },
  BANK:  { addr: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', decimals: 18 },
  APS:   { addr: '0xff56eb5b1a7faa972291117e5e9565da29bc808d', decimals: 18 },
  WETH:  { addr: '0x1502FA4be69d526124D453619276FacCab275d3D', decimals: 18 },
  WBTC:  { addr: '0x5D9ab5522c64E1F6ef5e3627ECCc093f56167818', decimals: 8 },
};

// ABIs
const ROUTER_ABI = [
  'function factory() view returns (address)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
];

const FACTORY_ABI = ['function getPair(address, address) view returns (address)'];

const PAIR_ABI = [
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)'
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// Get token info (case-insensitive)
function getTokenInfo(symbolOrAddr) {
  // Try exact match first
  if (TOKENS[symbolOrAddr]) {
    return { symbol: symbolOrAddr, ...TOKENS[symbolOrAddr] };
  }
  // Try case-insensitive match
  const lower = symbolOrAddr.toLowerCase();
  for (const [key, value] of Object.entries(TOKENS)) {
    if (key.toLowerCase() === lower) {
      return { symbol: key, ...value };
    }
  }
  // Try to match by address
  for (const [sym, info] of Object.entries(TOKENS)) {
    if (info.addr.toLowerCase() === symbolOrAddr.toLowerCase()) {
      return { symbol: sym, ...info };
    }
  }
  // Unknown token - assume 18 decimals
  return { symbol: symbolOrAddr, addr: symbolOrAddr, decimals: 18 };
}

// Get quote using router
async function getQuote(provider, fromToken, toToken, amountIn) {
  const fromInfo = getTokenInfo(fromToken);
  const toInfo = getTokenInfo(toToken);
  
  const router = new ethers.Contract(BLAZESWAP_ROUTER, ROUTER_ABI, provider);
  const factory = new ethers.Contract(BLAZESWAP_FACTORY, FACTORY_ABI, provider);
  
  // Check pair exists
  const pairAddr = await factory.getPair(fromInfo.addr, toInfo.addr);
  if (pairAddr === ethers.ZeroAddress) {
    throw new Error(`No Blazeswap pair found for ${fromToken}/${toToken}`);
  }
  
  const amountInWei = ethers.parseUnits(amountIn.toString(), fromInfo.decimals);
  const path = [fromInfo.addr, toInfo.addr];
  
  const amounts = await router.getAmountsOut(amountInWei, path);
  const amountOutWei = amounts[1];
  
  // Get reserves for display
  const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
  const [reserves, token0] = await Promise.all([pair.getReserves(), pair.token0()]);
  
  const isToken0In = fromInfo.addr.toLowerCase() === token0.toLowerCase();
  const reserveIn = isToken0In ? reserves[0] : reserves[1];
  const reserveOut = isToken0In ? reserves[1] : reserves[0];
  
  return {
    fromToken: fromInfo.symbol,
    toToken: toInfo.symbol,
    fromAmount: amountIn,
    toAmount: ethers.formatUnits(amountOutWei, toInfo.decimals),
    toAmountWei: amountOutWei,
    pairAddress: pairAddr,
    fromInfo,
    toInfo,
    rate: parseFloat(ethers.formatUnits(amountOutWei, toInfo.decimals)) / amountIn,
    reserveIn: parseFloat(ethers.formatUnits(reserveIn, fromInfo.decimals)),
    reserveOut: parseFloat(ethers.formatUnits(reserveOut, toInfo.decimals))
  };
}

// Execute atomic swap via router
async function executeSwap(signer, quote, slippage = 1) {
  const { fromInfo, toInfo, toAmountWei, fromAmount } = quote;
  const walletAddr = await signer.getAddress();
  
  const amountInWei = ethers.parseUnits(fromAmount.toString(), fromInfo.decimals);
  const minAmountOut = toAmountWei * BigInt(Math.floor((100 - slippage) * 100)) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  
  // Check/set allowance for router
  const tokenContract = new ethers.Contract(fromInfo.addr, ERC20_ABI, signer);
  const allowance = await tokenContract.allowance(walletAddr, BLAZESWAP_ROUTER);
  
  if (allowance < amountInWei) {
    console.log(`\n📝 Approving Blazeswap router...`);
    const approveTx = await tokenContract.approve(BLAZESWAP_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log(`   ✅ Approved`);
  }
  
  // Execute atomic swap
  console.log(`\n🔄 Executing atomic swap via router...`);
  console.log(`   Min output: ${ethers.formatUnits(minAmountOut, toInfo.decimals)} ${toInfo.symbol}`);
  
  const router = new ethers.Contract(BLAZESWAP_ROUTER, ROUTER_ABI, signer);
  const path = [fromInfo.addr, toInfo.addr];
  
  const tx = await router.swapExactTokensForTokens(
    amountInWei,
    minAmountOut,
    path,
    walletAddr,
    deadline
  );
  
  console.log(`   Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   ✅ Swap confirmed in block ${receipt.blockNumber}`);
  
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  };
}

// Load wallet from keystore
async function loadWallet(keystorePath, provider) {
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  if (keystore.privateKey) {
    return new ethers.Wallet(keystore.privateKey, provider);
  }
  throw new Error('Keystore must contain privateKey field');
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Blazeswap V2 Swap (Atomic via Router)
=====================================

MEV-safe atomic swaps using Blazeswap router.

Usage:
  node swap-blazeswap.js quote --from <TOKEN> --to <TOKEN> --amount <N>
  node swap-blazeswap.js swap --keystore <PATH> --from <TOKEN> --to <TOKEN> --amount <N> [--slippage <N>]
  node swap-blazeswap.js pairs

Examples:
  node swap-blazeswap.js quote --from WFLR --to FXRP --amount 100
  node swap-blazeswap.js swap --keystore ./wallet.json --from WFLR --to FXRP --amount 100 --slippage 1

Tokens: ${Object.keys(TOKENS).join(', ')}
Router: ${BLAZESWAP_ROUTER}
Factory: ${BLAZESWAP_FACTORY}
Fee: 0.3%
`);
    return;
  }
  
  const command = args[0];
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : null;
  };
  
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  if (command === 'pairs') {
    console.log('\n📋 Checking Blazeswap pairs...\n');
    const factory = new ethers.Contract(BLAZESWAP_FACTORY, [...FACTORY_ABI, 'function allPairsLength() view returns (uint)'], provider);
    const count = await factory.allPairsLength();
    console.log(`Total pairs: ${count}`);
    
    const commonPairs = [
      ['WFLR', 'FXRP'],
      ['WFLR', 'sFLR'],
      ['WFLR', 'USDT0'],
      ['WFLR', 'USDCe'],
      ['FXRP', 'USDT0'],
      ['sFLR', 'USDT0'],
    ];
    
    console.log('\nCommon pairs:');
    for (const [a, b] of commonPairs) {
      try {
        const tokenA = TOKENS[a] || TOKENS[a.toUpperCase()];
        const tokenB = TOKENS[b] || TOKENS[b.toUpperCase()];
        if (tokenA && tokenB) {
          const pair = await factory.getPair(tokenA.addr, tokenB.addr);
          if (pair !== ethers.ZeroAddress) {
            console.log(`  ${a}/${b}: ${pair}`);
          }
        }
      } catch (e) {}
    }
    return;
  }
  
  const fromToken = getArg('from');
  const toToken = getArg('to');
  const amount = parseFloat(getArg('amount') || '0');
  const slippage = parseFloat(getArg('slippage') || '1');
  const keystorePath = getArg('keystore');
  
  if (!fromToken || !toToken || !amount) {
    console.error('❌ Missing required arguments: --from, --to, --amount');
    process.exit(1);
  }
  
  if (command === 'quote') {
    console.log(`\n🔍 Blazeswap Quote: ${amount} ${fromToken} → ${toToken}`);
    
    const quote = await getQuote(provider, fromToken, toToken, amount);
    
    console.log(`\n📊 Result:`);
    console.log(`   Input:  ${quote.fromAmount} ${quote.fromToken}`);
    console.log(`   Output: ${parseFloat(quote.toAmount).toFixed(6)} ${quote.toToken}`);
    console.log(`   Rate:   1 ${quote.fromToken} = ${quote.rate.toFixed(6)} ${quote.toToken}`);
    console.log(`   Pair:   ${quote.pairAddress}`);
    console.log(`   Router: ${BLAZESWAP_ROUTER}`);
    console.log(`   Fee:    0.3%`);
    console.log(`\n   Reserves:`);
    console.log(`     ${quote.fromToken}: ${quote.reserveIn.toLocaleString()}`);
    console.log(`     ${quote.toToken}: ${quote.reserveOut.toLocaleString()}`);
    
    return;
  }
  
  if (command === 'swap') {
    if (!keystorePath) {
      console.error('❌ Swap requires --keystore');
      process.exit(1);
    }
    
    const wallet = await loadWallet(keystorePath, provider);
    console.log(`\n👛 Wallet: ${wallet.address}`);
    
    // Get quote
    const quote = await getQuote(provider, fromToken, toToken, amount);
    
    console.log(`\n📊 Swap Preview (Blazeswap - Atomic):`);
    console.log(`   Input:  ${quote.fromAmount} ${quote.fromToken}`);
    console.log(`   Output: ~${parseFloat(quote.toAmount).toFixed(6)} ${quote.toToken}`);
    console.log(`   Min:    ${(parseFloat(quote.toAmount) * (100 - slippage) / 100).toFixed(6)} ${quote.toToken} (${slippage}% slippage)`);
    console.log(`   Router: ${BLAZESWAP_ROUTER}`);
    
    // Check balance
    const tokenContract = new ethers.Contract(quote.fromInfo.addr, ERC20_ABI, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    const balanceFormatted = ethers.formatUnits(balance, quote.fromInfo.decimals);
    console.log(`\n   Balance: ${balanceFormatted} ${quote.fromToken}`);
    
    const amountInWei = ethers.parseUnits(amount.toString(), quote.fromInfo.decimals);
    if (balance < amountInWei) {
      console.error(`\n❌ Insufficient balance!`);
      process.exit(1);
    }
    
    // Execute atomic swap
    const result = await executeSwap(wallet, quote, slippage);
    
    console.log(`\n🎉 Swap complete!`);
    console.log(`   Explorer: https://flarescan.com/tx/${result.hash}`);
    console.log(`   Gas used: ${result.gasUsed.toString()}`);
    
    return;
  }
  
  console.error(`❌ Unknown command: ${command}`);
  process.exit(1);
}

// Export for use as module
module.exports = { getQuote, executeSwap, TOKENS, BLAZESWAP_ROUTER, BLAZESWAP_FACTORY };

if (require.main === module) {
  main().catch(err => {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  });
}
