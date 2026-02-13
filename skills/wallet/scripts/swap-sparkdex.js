#!/usr/bin/env node
/**
 * SparkDex V3.1 Swap Script
 * 
 * Test swap via SparkDex SwapRouter on Flare
 */

const { ethers } = require('ethers');
const fs = require('fs');

const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';

// SparkDex V3.1 Contracts (verified working)
const SPARKDEX_ROUTER = '0x8a1E35F5c98C4E85B36B7B253222eE17773b2781';
const SPARKDEX_FACTORY = '0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652';
const SPARKDEX_QUOTER = '0x5B5513c55fd06e2658010c121c37b07fC8e8B705';

// Token Addresses
const TOKENS = {
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  FXRP: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
  SFLR: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
  STXRP: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3',
  USDT0: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D',
  USDC: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6',
};

const DECIMALS = {
  WFLR: 18,
  FXRP: 6,
  SFLR: 18,
  STXRP: 6,
  USDT0: 6,
  USDC: 6,
};

// Known SparkDex V3.1 Pools
const KNOWN_POOLS = {
  'WFLR/STXRP': { address: '0x8ee8414eE2B9D4Bf6c8DE40d95167C2643C2c544', fee: 500 },
  'WFLR/FXRP-500': { address: '0x589689984a06E4640593eDec64e415c415940C7F', fee: 500 },
  'WFLR/FXRP-3000': { address: '0xDAD1976C48cf93A7D90f106382C60Cd2c888b2dc', fee: 3000 },
  'WFLR/FXRP-10000': { address: '0x08E6cB0c6b91dba21B9b5DFF5694faB75fA91440', fee: 10000 },
};

// ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
];

const FACTORY_ABI = [
  'function getPool(address,address,uint24) view returns (address)'
];

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)'
];

// SwapRouter exactInputSingle (standard V3 interface)
const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
];

/**
 * Encode path for V3 swap
 */
function encodePath(tokens, fees) {
  let path = tokens[0].toLowerCase().slice(2);
  for (let i = 0; i < fees.length; i++) {
    path += fees[i].toString(16).padStart(6, '0');
    path += tokens[i + 1].toLowerCase().slice(2);
  }
  return '0x' + path;
}

async function main() {
  const args = process.argv.slice(2);
  
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  const keystorePath = getArg('keystore');
  const fromToken = (getArg('from') || 'WFLR').toUpperCase();
  const toToken = (getArg('to') || 'FXRP').toUpperCase();
  const amount = getArg('amount') || '1';
  const fee = parseInt(getArg('fee') || '3000');
  const slippage = parseFloat(getArg('slippage') || '2') / 100;
  
  if (!keystorePath) {
    console.error('Usage: node swap-sparkdex.js --keystore <path> --from WFLR --to FXRP --amount 1');
    process.exit(1);
  }
  
  const tokenInAddr = TOKENS[fromToken];
  const tokenOutAddr = TOKENS[toToken];
  const decIn = DECIMALS[fromToken];
  const decOut = DECIMALS[toToken];
  
  if (!tokenInAddr || !tokenOutAddr) {
    console.error(`Unknown token. Available: ${Object.keys(TOKENS).join(', ')}`);
    process.exit(1);
  }
  
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);
  const walletData = JSON.parse(fs.readFileSync(keystorePath));
  const signer = new ethers.Wallet(walletData.privateKey, provider);
  const walletAddress = await signer.getAddress();
  
  console.log(`\n🔷 SparkDex V3.1 Swap`);
  console.log(`   Wallet: ${walletAddress}`);
  console.log(`   Swap: ${amount} ${fromToken} → ${toToken}`);
  console.log(`   Fee tier: ${fee/10000}%`);
  
  // Check pool exists
  const factory = new ethers.Contract(SPARKDEX_FACTORY, FACTORY_ABI, provider);
  const poolAddress = await factory.getPool(tokenInAddr, tokenOutAddr, fee);
  
  if (poolAddress === ethers.ZeroAddress) {
    console.error(`\n❌ No SparkDex pool found for ${fromToken}/${toToken} at ${fee/10000}% fee`);
    process.exit(1);
  }
  
  console.log(`   Pool: ${poolAddress}`);
  
  // Get pool price for estimate
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [slot0, token0, liquidity] = await Promise.all([
    pool.slot0(),
    pool.token0(),
    pool.liquidity()
  ]);
  
  const sqrtPriceX96 = slot0[0];
  const isToken0 = tokenInAddr.toLowerCase() === token0.toLowerCase();
  const price = Number(sqrtPriceX96) / (2 ** 96);
  const priceSquared = price * price;
  
  const amountIn = ethers.parseUnits(amount, decIn);
  
  // Estimate output (rough)
  let estimatedOut;
  if (isToken0) {
    estimatedOut = Number(amountIn) * priceSquared * 0.997;
  } else {
    estimatedOut = Number(amountIn) / priceSquared * 0.997;
  }
  
  // Adjust for decimals
  const decimalAdjust = 10 ** (decOut - decIn);
  estimatedOut = estimatedOut * decimalAdjust;
  
  const amountOutMin = BigInt(Math.floor(estimatedOut * (1 - slippage)));
  
  console.log(`   Estimated out: ~${(estimatedOut / 10**decOut).toFixed(6)} ${toToken}`);
  console.log(`   Min output (${slippage*100}% slippage): ${ethers.formatUnits(amountOutMin, decOut)} ${toToken}`);
  console.log(`   Liquidity: ${liquidity.toString()}`);
  
  // Check balance
  const tokenContract = new ethers.Contract(tokenInAddr, ERC20_ABI, signer);
  const balance = await tokenContract.balanceOf(walletAddress);
  
  if (balance < amountIn) {
    console.error(`\n❌ Insufficient balance. Have: ${ethers.formatUnits(balance, decIn)} ${fromToken}`);
    process.exit(1);
  }
  
  // Approve if needed
  const allowance = await tokenContract.allowance(walletAddress, SPARKDEX_ROUTER);
  if (allowance < amountIn) {
    console.log(`\n📝 Approving SparkDex Router...`);
    const approveTx = await tokenContract.approve(SPARKDEX_ROUTER, ethers.MaxUint256);
    await approveTx.wait();
    console.log(`   Approved ✓`);
  }
  
  // Execute swap via exactInputSingle
  const router = new ethers.Contract(SPARKDEX_ROUTER, ROUTER_ABI, signer);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  
  const params = {
    tokenIn: tokenInAddr,
    tokenOut: tokenOutAddr,
    fee: fee,
    recipient: walletAddress,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0n // No limit
  };
  
  console.log(`\n🔄 Executing swap...`);
  
  try {
    const tx = await router.exactInputSingle(params);
    console.log(`   Tx submitted: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`\n✅ Swap complete!`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    
  } catch (err) {
    console.error(`\n❌ Swap failed: ${err.message}`);
    if (err.data) console.error(`   Data: ${err.data}`);
    process.exit(1);
  }
}

main().catch(console.error);
