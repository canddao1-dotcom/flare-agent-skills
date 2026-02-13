#!/usr/bin/env node
/**
 * V3 Swap Script using Enosys SwapRouter
 * 
 * Swaps via Uniswap V3 style router on Flare (Enosys)
 */

const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const FLARE_RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';

// Enosys SwapRouter (actual V3 swap router)
const SWAP_ROUTER = '0x5FD34090E9b195d8482Ad3CC63dB078534F1b113';

// Token Addresses
const TOKENS = {
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  BANK: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059',
  FXRP: '0xad552a648c74d49e10027ab8a618a3ad4901c5be',
  SFLR: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
  HLN: '0x140D8d3649Ec605CF69018C627fB44cCC76eC89f',
  USDT0: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
  USDCE: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6',
  CDP: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F',
  RFLR: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e',
  STXRP: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3',
  APS: '0xff56eb5b1a7faa972291117e5e9565da29bc808d',
};

// ABIs
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Enosys SwapRouter ABI - based on ai-miguel swap_provider.py
const SWAP_ROUTER_ABI = [
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
];

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)'
];

const FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)'
];

// Enosys V3 Factory
const ENOSYS_FACTORY = '0x17AA157AC8C54034381b840Cb8f6bf7Fc355f0de';

/**
 * Get pool address from factory
 */
async function getPool(provider, tokenA, tokenB, fee = 3000) {
  const factory = new ethers.Contract(ENOSYS_FACTORY, FACTORY_ABI, provider);
  return await factory.getPool(tokenA, tokenB, fee);
}

/**
 * Get quote by simulating against pool using tick-based calculation
 * 
 * ⚠️ WARNING: For low-liquidity pools, this estimate can be significantly wrong!
 * For accurate quotes, use on-chain QuoterV2 contract.
 */
async function getQuote(provider, tokenIn, tokenOut, amountIn, fee = 3000) {
  const poolAddress = await getPool(provider, tokenIn, tokenOut, fee);
  
  if (poolAddress === ethers.ZeroAddress) {
    return null;
  }
  
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [slot0, token0, liquidity] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.liquidity()
  ]);
  
  const sqrtPriceX96 = slot0[0];
  const currentTick = Number(slot0[1]);
  const L = BigInt(liquidity.toString());
  const isToken0 = tokenIn.toLowerCase() === token0.toLowerCase();
  const Q96 = BigInt(2) ** BigInt(96);
  
  // Fee deduction (e.g., 3000 = 0.3%)
  const feeMultiplier = BigInt(1000000 - fee);
  const amountInAfterFee = BigInt(amountIn.toString()) * feeMultiplier / BigInt(1000000);
  
  // ⚠️ LOW LIQUIDITY WARNING
  // Check if swap amount is significant relative to pool liquidity
  const liquidityThreshold = L / BigInt(100); // 1% of liquidity
  const isLowLiquidity = amountInAfterFee > liquidityThreshold;
  
  let amountOut;
  let warning = null;
  
  if (L === BigInt(0)) {
    // No liquidity in pool
    warning = '⚠️ CRITICAL: Pool has ZERO liquidity!';
    amountOut = BigInt(0);
  } else if (isLowLiquidity) {
    // Low liquidity - use tick-based simulation
    warning = '⚠️ WARNING: Low liquidity pool! Quote may be significantly inaccurate.';
    
    // For token1 -> token0 (zeroForOne = false, price goes UP):
    // deltaSqrtPrice = deltaY * Q96 / L
    // deltaX = L * Q96 / sqrtPriceAfter - L * Q96 / sqrtPriceBefore
    
    const sqrtP = BigInt(sqrtPriceX96.toString());
    
    if (!isToken0) {
      // Selling token1 for token0
      const deltaSqrtPrice = amountInAfterFee * Q96 / L;
      const sqrtPriceAfter = sqrtP + deltaSqrtPrice;
      
      const xBefore = L * Q96 / sqrtP;
      const xAfter = L * Q96 / sqrtPriceAfter;
      amountOut = xBefore > xAfter ? xBefore - xAfter : BigInt(0);
    } else {
      // Selling token0 for token1
      const deltaSqrtPrice = amountInAfterFee * Q96 / L;
      const sqrtPriceAfter = sqrtP > deltaSqrtPrice ? sqrtP - deltaSqrtPrice : BigInt(1);
      
      const yBefore = L * sqrtP / Q96;
      const yAfter = L * sqrtPriceAfter / Q96;
      amountOut = yBefore > yAfter ? yBefore - yAfter : BigInt(0);
    }
  } else {
    // Normal liquidity - use naive price calculation (faster, accurate for small swaps)
    const price = Number(sqrtPriceX96) / Number(Q96);
    const priceSquared = price * price;
    
    if (isToken0) {
      amountOut = BigInt(Math.floor(Number(amountInAfterFee) * priceSquared));
    } else {
      amountOut = BigInt(Math.floor(Number(amountInAfterFee) / priceSquared));
    }
  }
  
  // Log warning if applicable
  if (warning) {
    console.warn(warning);
    console.warn(`   Pool: ${poolAddress}`);
    console.warn(`   Liquidity: ${liquidity.toString()}`);
    console.warn(`   Amount: ${amountIn.toString()}`);
  }
  
  return {
    amountOut,
    poolAddress,
    sqrtPriceX96,
    liquidity,
    fee,
    currentTick,
    isLowLiquidity,
    warning
  };
}

/**
 * Get the best quote across all fee tiers
 */
async function getBestQuote(provider, tokenIn, tokenOut, amountIn) {
  const fees = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
  let bestQuote = null;
  
  for (const fee of fees) {
    try {
      const quote = await getQuote(provider, tokenIn, tokenOut, amountIn, fee);
      if (!quote || quote.amountOut === BigInt(0)) continue;
      
      if (!bestQuote || quote.amountOut > bestQuote.amountOut) {
        bestQuote = quote;
      }
    } catch (e) {
      // Pool doesn't exist or error, skip
    }
  }
  
  return bestQuote;
}

/**
 * Encode path for V3 swap (token + fee + token + fee + token...)
 */
function encodePath(tokens, fees) {
  if (tokens.length !== fees.length + 1) {
    throw new Error('Invalid path');
  }
  
  let path = tokens[0].toLowerCase().slice(2);
  for (let i = 0; i < fees.length; i++) {
    path += fees[i].toString(16).padStart(6, '0');
    path += tokens[i + 1].toLowerCase().slice(2);
  }
  return '0x' + path;
}

/**
 * Execute V3 swap via SwapRouter using exactInput
 */
async function executeSwap(signer, tokenIn, tokenOut, amountIn, amountOutMin, fee = 3000) {
  const provider = signer.provider;
  const walletAddress = await signer.getAddress();
  
  // Check and approve tokens
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, signer);
  const currentAllowance = await tokenContract.allowance(walletAddress, SWAP_ROUTER);
  
  if (currentAllowance < amountIn) {
    console.log('Approving SwapRouter...');
    const approveTx = await tokenContract.approve(SWAP_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log('Approval confirmed');
  }
  
  // Build swap transaction using exactInput
  const router = new ethers.Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, signer);
  
  // Encode path: tokenIn + fee + tokenOut
  const path = encodePath([tokenIn, tokenOut], [fee]);
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  
  const params = {
    path: path,
    recipient: walletAddress,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
  };
  
  console.log('Executing swap via SwapRouter (exactInput)...');
  const tx = await router.exactInput(params);
  const receipt = await tx.wait();
  
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
Usage: node swap-v3.js <command> [options]

Commands:
  pools     List available V3 pools
  quote     Get a swap quote
  swap      Execute a V3 swap

Options:
  --keystore <path>   Path to wallet keystore JSON
  --from <token>      Input token symbol
  --to <token>        Output token symbol
  --amount <num>      Amount to swap (human readable)
  --slippage <pct>    Slippage percentage, default: 1
  --fee <num>         Pool fee tier (500, 3000, 10000), default: 3000

Available Tokens: WFLR, SFLR, FXRP, HLN, BANK

Examples:
  # Check available pools
  node swap-v3.js pools
  
  # Get quote for 10 WFLR to SFLR
  node swap-v3.js quote --from WFLR --to SFLR --amount 10
  
  # Execute swap
  node swap-v3.js swap --keystore wallet.json --from WFLR --to SFLR --amount 10
`);
    return;
  }
  
  const command = args[0];
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  const fromToken = getArg('from');
  const toToken = getArg('to');
  const amount = getArg('amount');
  const slippage = parseFloat(getArg('slippage') || '1') / 100;
  const fee = parseInt(getArg('fee') || '3000');
  const keystorePath = getArg('keystore');
  
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);
  
  const resolveToken = (token) => {
    if (!token) return null;
    if (token.startsWith('0x')) return token;
    return TOKENS[token.toUpperCase()] || null;
  };
  
  if (command === 'pools') {
    console.log('\n📊 Checking Enosys V3 Pools...\n');
    
    const pairs = [
      ['WFLR', 'SFLR'],
      ['WFLR', 'FXRP'],
      ['WFLR', 'HLN'],
      ['WFLR', 'BANK'],
      ['SFLR', 'FXRP'],
    ];
    
    for (const [t1, t2] of pairs) {
      const addr1 = TOKENS[t1];
      const addr2 = TOKENS[t2];
      
      for (const f of [500, 3000, 10000]) {
        const pool = await getPool(provider, addr1, addr2, f);
        if (pool !== ethers.ZeroAddress) {
          const poolContract = new ethers.Contract(pool, POOL_ABI, provider);
          const liquidity = await poolContract.liquidity();
          console.log(`${t1}/${t2} (${f/10000}%): ${pool}`);
          console.log(`  Liquidity: ${liquidity.toString()}`);
        }
      }
    }
    
  } else if (command === 'quote') {
    if (!fromToken || !toToken || !amount) {
      console.error('Missing required options: --from, --to, --amount');
      process.exit(1);
    }
    
    const tokenInAddr = resolveToken(fromToken);
    const tokenOutAddr = resolveToken(toToken);
    
    if (!tokenInAddr || !tokenOutAddr) {
      console.error('Unknown token');
      process.exit(1);
    }
    
    const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, provider);
    const tokenOut = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
    const [decIn, decOut] = await Promise.all([
      tokenIn.decimals(),
      tokenOut.decimals()
    ]);
    
    const amountIn = ethers.parseUnits(amount, decIn);
    const quote = await getQuote(provider, tokenInAddr, tokenOutAddr, amountIn, fee);
    
    if (!quote) {
      console.log(`❌ No pool found for ${fromToken}/${toToken} with fee ${fee}`);
      process.exit(1);
    }
    
    console.log(`\n📊 Quote on Enosys V3`);
    console.log(`   Pool: ${quote.poolAddress}`);
    console.log(`   ${amount} ${fromToken} → ~${ethers.formatUnits(quote.amountOut, decOut)} ${toToken}`);
    console.log(`   Fee tier: ${fee/10000}%`);
    
  } else if (command === 'swap') {
    if (!keystorePath || !fromToken || !toToken || !amount) {
      console.error('Missing required options: --keystore, --from, --to, --amount');
      process.exit(1);
    }
    
    const tokenInAddr = resolveToken(fromToken);
    const tokenOutAddr = resolveToken(toToken);
    
    if (!tokenInAddr || !tokenOutAddr) {
      console.error('Unknown token');
      process.exit(1);
    }
    
    // Load wallet (supports both encrypted keystore and plain privateKey)
    const walletData = JSON.parse(fs.readFileSync(keystorePath));
    let signer;
    if (walletData.privateKey) {
      // Plain format
      signer = new ethers.Wallet(walletData.privateKey, provider);
    } else if (walletData.Crypto || walletData.crypto) {
      // Encrypted V3 keystore - need password
      const passwordPath = process.env.KEYSTORE_PASSWORD_PATH;
      const password = process.env.KEYSTORE_PASSWORD || fs.readFileSync(passwordPath, 'utf8').trim();
      signer = await ethers.Wallet.fromEncryptedJson(JSON.stringify(walletData), password);
      signer = signer.connect(provider);
    } else {
      console.error('Invalid keystore format');
      process.exit(1);
    }
    
    const tokenIn = new ethers.Contract(tokenInAddr, ERC20_ABI, provider);
    const tokenOut = new ethers.Contract(tokenOutAddr, ERC20_ABI, provider);
    const [decIn, decOut] = await Promise.all([
      tokenIn.decimals(),
      tokenOut.decimals()
    ]);
    
    const amountIn = ethers.parseUnits(amount, decIn);
    
    console.log(`\n📊 Getting quote...`);
    const quote = await getQuote(provider, tokenInAddr, tokenOutAddr, amountIn, fee);
    
    if (!quote) {
      console.error(`❌ No pool found for ${fromToken}/${toToken}`);
      process.exit(1);
    }
    
    const amountOutMin = quote.amountOut * BigInt(Math.floor((1 - slippage) * 10000)) / 10000n;
    
    console.log(`   Expected: ~${ethers.formatUnits(quote.amountOut, decOut)} ${toToken}`);
    console.log(`   Min (${slippage * 100}% slippage): ${ethers.formatUnits(amountOutMin, decOut)} ${toToken}`);
    
    console.log(`\n🔄 Executing swap...`);
    const result = await executeSwap(signer, tokenInAddr, tokenOutAddr, amountIn, amountOutMin, fee);
    
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
  getQuote,
  getBestQuote,
  executeSwap,
  getPool,
  TOKENS,
  SWAP_ROUTER
};
