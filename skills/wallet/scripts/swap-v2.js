#!/usr/bin/env node
/**
 * V2 Swap Script for FlareBank
 * 
 * Swaps via Uniswap V2 style routers on Flare
 * Used for BANK and other tokens with V2 pools
 */

const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const FLARE_RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';

// Token Addresses
const TOKENS = {
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  BANK: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059',
  FXRP: '0xad552a648c74d49e10027ab8a618a3ad4901c5be',
  sFLR: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
};

// V2 Router ABI
const ROUTER_ABI = [
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  'function getAmountsIn(uint amountOut, address[] path) view returns (uint[] amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] path, address to, uint deadline) returns (uint[] amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)'
];

// Factory ABI
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
  'function allPairsLength() view returns (uint)'
];

// Pair ABI
const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];

// ERC20 ABI
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

/**
 * Find router for a given factory
 */
async function findRouterForPair(provider, pairAddress) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const factory = await pair.factory().catch(() => null);
  
  if (!factory) {
    // Try getting factory from pair contract storage
    const pairWithFactory = new ethers.Contract(pairAddress, [...PAIR_ABI, 'function factory() view returns (address)'], provider);
    return await pairWithFactory.factory().catch(() => null);
  }
  
  return factory;
}

/**
 * Get quote for V2 swap using pair reserves directly
 */
async function getQuoteV2(provider, pairAddress, tokenIn, amountIn) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  
  const [reserves, token0] = await Promise.all([
    pair.getReserves(),
    pair.token0()
  ]);
  
  const isToken0 = tokenIn.toLowerCase() === token0.toLowerCase();
  const reserveIn = isToken0 ? reserves[0] : reserves[1];
  const reserveOut = isToken0 ? reserves[1] : reserves[0];
  
  // Uniswap V2 formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  const amountOut = numerator / denominator;
  
  return {
    amountOut,
    reserveIn,
    reserveOut,
    priceImpact: Number(amountIn) / Number(reserveIn) * 100
  };
}

/**
 * Execute V2 swap directly through pair (low-level)
 */
async function executeSwapV2Direct(signer, pairAddress, tokenIn, tokenOut, amountIn, amountOutMin) {
  const provider = signer.provider;
  const walletAddress = await signer.getAddress();
  
  // First approve pair to spend tokens
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, signer);
  const currentAllowance = await tokenContract.allowance(walletAddress, pairAddress);
  
  if (currentAllowance < amountIn) {
    console.log('Approving pair to spend tokens...');
    const approveTx = await tokenContract.approve(pairAddress, ethers.MaxUint256);
    await approveTx.wait();
    console.log('Approval confirmed');
  }
  
  // Get pair info
  const pair = new ethers.Contract(pairAddress, [
    ...PAIR_ABI,
    'function swap(uint amount0Out, uint amount1Out, address to, bytes data)'
  ], signer);
  
  const token0 = await pair.token0();
  const isToken0 = tokenIn.toLowerCase() === token0.toLowerCase();
  
  // Transfer tokens to pair first
  console.log('Transferring tokens to pair...');
  const transferTx = await tokenContract.transfer(pairAddress, amountIn);
  await transferTx.wait();
  
  // Execute swap
  const amount0Out = isToken0 ? 0n : amountOutMin;
  const amount1Out = isToken0 ? amountOutMin : 0n;
  
  console.log('Executing swap...');
  const swapTx = await pair.swap(amount0Out, amount1Out, walletAddress, '0x');
  const receipt = await swapTx.wait();
  
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString()
  };
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length < 1) {
    console.log(`
Usage: node swap-v2.js <command> [options]

Commands:
  quote     Get a swap quote using V2 pair
  swap      Execute a swap via V2 pair (direct)
  info      Get pair info

Options:
  --keystore <path>   Path to wallet keystore JSON
  --pair <address>    V2 pair contract address
  --from <token>      Input token symbol or address
  --to <token>        Output token symbol or address
  --amount <num>      Amount to swap (human readable)
  --slippage <pct>    Slippage percentage, default: 1

Known Pairs:
  BANK/WFLR Enosys:   0x5f29c8d049e47dd180c2b83e3560e8e271110335
  BANK/WFLR SparkDex: 0x0f574fc895c1abf82aeff334fa9d8ba43f866111

Examples:
  # Get quote for 100 WFLR to BANK on Enosys V2
  node swap-v2.js quote --pair 0x5f29c8d049e47dd180c2b83e3560e8e271110335 --from WFLR --amount 100
  
  # Execute swap with 1% slippage
  node swap-v2.js swap --keystore wallet.json --pair 0x5f29c8d049e47dd180c2b83e3560e8e271110335 --from WFLR --amount 10 --slippage 1
`);
    return;
  }
  
  const command = args[0];
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  const pairAddress = getArg('pair');
  const fromToken = getArg('from');
  const amount = getArg('amount');
  const slippage = parseFloat(getArg('slippage') || '1') / 100;
  const keystorePath = getArg('keystore');
  
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);
  
  // Resolve token addresses
  const resolveToken = (token) => {
    if (!token) return null;
    if (token.startsWith('0x')) return token;
    return TOKENS[token.toUpperCase()] || null;
  };
  
  if (command === 'info') {
    if (!pairAddress) {
      console.error('Missing required option: --pair');
      process.exit(1);
    }
    
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [reserves, token0, token1] = await Promise.all([
      pair.getReserves(),
      pair.token0(),
      pair.token1()
    ]);
    
    // Get token symbols
    const t0 = new ethers.Contract(token0, ERC20_ABI, provider);
    const t1 = new ethers.Contract(token1, ERC20_ABI, provider);
    const [sym0, sym1, dec0, dec1] = await Promise.all([
      t0.symbol(),
      t1.symbol(),
      t0.decimals(),
      t1.decimals()
    ]);
    
    console.log(`\n📊 Pair Info: ${pairAddress}`);
    console.log(`   Token0: ${sym0} (${token0})`);
    console.log(`   Token1: ${sym1} (${token1})`);
    console.log(`   Reserve0: ${ethers.formatUnits(reserves[0], dec0)} ${sym0}`);
    console.log(`   Reserve1: ${ethers.formatUnits(reserves[1], dec1)} ${sym1}`);
    console.log(`   Price: 1 ${sym0} = ${(Number(reserves[1]) / Number(reserves[0])).toFixed(6)} ${sym1}`);
    
  } else if (command === 'quote') {
    if (!pairAddress || !fromToken || !amount) {
      console.error('Missing required options: --pair, --from, --amount');
      process.exit(1);
    }
    
    const tokenInAddr = resolveToken(fromToken);
    if (!tokenInAddr) {
      console.error(`Unknown token: ${fromToken}`);
      process.exit(1);
    }
    
    // Get pair tokens
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [token0, token1] = await Promise.all([
      pair.token0(),
      pair.token1()
    ]);
    
    const tokenOutAddr = tokenInAddr.toLowerCase() === token0.toLowerCase() ? token1 : token0;
    
    // Get decimals
    const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, provider);
    const tokenOut = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
    const [decIn, decOut, symIn, symOut] = await Promise.all([
      tokenIn.decimals(),
      tokenOut.decimals(),
      tokenIn.symbol(),
      tokenOut.symbol()
    ]);
    
    const amountIn = ethers.parseUnits(amount, decIn);
    const quote = await getQuoteV2(provider, pairAddress, tokenInAddr, amountIn);
    
    console.log(`\n📊 Quote on V2 Pair`);
    console.log(`   ${amount} ${symIn} → ${ethers.formatUnits(quote.amountOut, decOut)} ${symOut}`);
    console.log(`   Rate: 1 ${symIn} = ${(Number(ethers.formatUnits(quote.amountOut, decOut)) / parseFloat(amount)).toFixed(6)} ${symOut}`);
    console.log(`   Price impact: ${quote.priceImpact.toFixed(4)}%`);
    
  } else if (command === 'swap') {
    if (!keystorePath || !pairAddress || !fromToken || !amount) {
      console.error('Missing required options: --keystore, --pair, --from, --amount');
      process.exit(1);
    }
    
    const tokenInAddr = resolveToken(fromToken);
    if (!tokenInAddr) {
      console.error(`Unknown token: ${fromToken}`);
      process.exit(1);
    }
    
    // Load wallet
    const walletData = JSON.parse(fs.readFileSync(keystorePath));
    const signer = new ethers.Wallet(walletData.privateKey, provider);
    
    // Get pair tokens
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
    const [token0, token1] = await Promise.all([
      pair.token0(),
      pair.token1()
    ]);
    
    const tokenOutAddr = tokenInAddr.toLowerCase() === token0.toLowerCase() ? token1 : token0;
    
    // Get decimals
    const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, provider);
    const tokenOut = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
    const [decIn, decOut, symIn, symOut] = await Promise.all([
      tokenIn.decimals(),
      tokenOut.decimals(),
      tokenIn.symbol(),
      tokenOut.symbol()
    ]);
    
    const amountIn = ethers.parseUnits(amount, decIn);
    
    // Get quote
    console.log(`\n📊 Getting quote...`);
    const quote = await getQuoteV2(provider, pairAddress, tokenInAddr, amountIn);
    const amountOutMin = quote.amountOut * BigInt(Math.floor((1 - slippage) * 10000)) / 10000n;
    
    console.log(`   Expected: ${ethers.formatUnits(quote.amountOut, decOut)} ${symOut}`);
    console.log(`   Min (${slippage * 100}% slippage): ${ethers.formatUnits(amountOutMin, decOut)} ${symOut}`);
    console.log(`   Price impact: ${quote.priceImpact.toFixed(4)}%`);
    
    console.log(`\n🔄 Executing swap...`);
    const result = await executeSwapV2Direct(signer, pairAddress, tokenInAddr, tokenOutAddr, amountIn, amountOutMin);
    
    console.log(`\n✅ Swap complete!`);
    console.log(`   Tx: ${result.hash}`);
    console.log(`   Block: ${result.blockNumber}`);
    console.log(`   Gas used: ${result.gasUsed}`);
    
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main().catch(console.error);

module.exports = {
  getQuoteV2,
  executeSwapV2Direct,
  TOKENS
};
