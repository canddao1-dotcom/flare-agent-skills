#!/usr/bin/env node
/**
 * Simple DEX Aggregator for Flare
 * 
 * Compares rates across Enosys V3 and SparkDex V3, routes to best venue
 */

const { ethers } = require('ethers');
const fs = require('fs');

const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
const DEFAULT_KEYSTORE = process.env.AGENT_KEYSTORE || './keystore.json';

// Token addresses
const TOKENS = {
  WFLR: { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  FXRP: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', decimals: 6 },
  sFLR: { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
  USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
  'USDC.e': { address: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', decimals: 6 },
  stXRP: { address: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', decimals: 6 },
};

// DEX Routers
const DEXES = {
  enosys: {
    name: 'Enosys V3',
    router: '0x5FD34090E9b195d8482Ad3CC63dB078534F1b113',
    quoter: '0x0A32EE3f66cC9E68ffb7cBeCf77bAef03e2d7C56',
    factory: '0x17AA157AC8C54034381b840Cb8f6bf7Fc355f0de',
  },
  sparkdex: {
    name: 'SparkDex V3.1',
    router: '0x8a1E35F5c98C4E85B36B7B253222eE17773b2781',
    quoter: '0x5B5513c55fd06e2658010c121c37b07fC8e8B705',
    factory: '0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652',
  },
};

const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

// ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
];

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const FACTORY_ABI = [
  'function getPool(address, address, uint24) view returns (address)',
];

const ROUTER_ABI = [
  // Enosys uses exactInput with encoded path
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
];

const SPARKDEX_ROUTER_ABI = [
  // SparkDex uses exactInputSingle with deadline in struct
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
];

// Encode path for V3 swap (token + fee + token)
function encodePath(tokens, fees) {
  let path = tokens[0].toLowerCase().slice(2);
  for (let i = 0; i < fees.length; i++) {
    path += fees[i].toString(16).padStart(6, '0');
    path += tokens[i + 1].toLowerCase().slice(2);
  }
  return '0x' + path;
}

async function getProvider() {
  return new ethers.JsonRpcProvider(FLARE_RPC);
}

async function getSigner(keystorePath) {
  const provider = await getProvider();
  const keystoreJson = fs.readFileSync(keystorePath || DEFAULT_KEYSTORE, 'utf8');
  const keystore = JSON.parse(keystoreJson);
  
  // Handle both encrypted keystores and plain private keys
  if (keystore.Crypto || keystore.crypto) {
    // Encrypted keystore - need password
    const passwordPath = (keystorePath || DEFAULT_KEYSTORE).replace('.json', '-password');
    const altPasswordPath = process.env.KEYSTORE_PASSWORD_PATH;
    let password;
    
    if (fs.existsSync(passwordPath)) {
      password = fs.readFileSync(passwordPath, 'utf8').trim();
    } else if (fs.existsSync(altPasswordPath)) {
      password = fs.readFileSync(altPasswordPath, 'utf8').trim();
    } else {
      throw new Error('No keystore password file found');
    }
    
    const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
    return wallet.connect(provider);
  } else if (keystore.privateKey) {
    return new ethers.Wallet(keystore.privateKey, provider);
  } else {
    throw new Error('Invalid keystore format');
  }
}

// Get quote from a DEX
async function getQuote(provider, dexKey, tokenIn, tokenOut, amountIn) {
  const dex = DEXES[dexKey];
  const quoter = new ethers.Contract(dex.quoter, QUOTER_V2_ABI, provider);
  const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
  
  let bestQuote = null;
  
  for (const fee of FEE_TIERS) {
    try {
      // Check if pool exists
      const pool = await factory.getPool(tokenIn, tokenOut, fee);
      if (pool === ethers.ZeroAddress) continue;
      
      // Get quote
      const params = {
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      };
      
      const [amountOut] = await quoter.quoteExactInputSingle.staticCall(params);
      
      if (!bestQuote || amountOut > bestQuote.amountOut) {
        bestQuote = {
          dex: dexKey,
          dexName: dex.name,
          fee,
          amountOut,
          pool,
        };
      }
    } catch (e) {
      // Pool doesn't exist or quote failed
    }
  }
  
  return bestQuote;
}

// Execute swap on Enosys (uses exactInput with path encoding)
async function swapEnosys(signer, tokenIn, tokenOut, amountIn, amountOutMin, fee) {
  const router = new ethers.Contract(DEXES.enosys.router, ROUTER_ABI, signer);
  const address = await signer.getAddress();
  const deadline = Math.floor(Date.now() / 1000) + 600;
  
  // Encode path: tokenIn + fee + tokenOut
  const path = encodePath([tokenIn, tokenOut], [fee]);
  
  const params = {
    path,
    recipient: address,
    deadline,
    amountIn,
    amountOutMinimum: amountOutMin,
  };
  
  return await router.exactInput(params);
}

// Execute swap on SparkDex
async function swapSparkDex(signer, tokenIn, tokenOut, amountIn, amountOutMin, fee) {
  const router = new ethers.Contract(DEXES.sparkdex.router, SPARKDEX_ROUTER_ABI, signer);
  const address = await signer.getAddress();
  const deadline = Math.floor(Date.now() / 1000) + 600;
  
  const params = {
    tokenIn,
    tokenOut,
    fee,
    recipient: address,
    deadline,
    amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0n,
  };
  
  return await router.exactInputSingle(params);
}

// ============ QUOTE ============
async function quote(fromSymbol, toSymbol, amount) {
  const provider = await getProvider();
  
  const fromToken = TOKENS[fromSymbol.toUpperCase()];
  const toToken = TOKENS[toSymbol.toUpperCase()];
  
  if (!fromToken || !toToken) {
    console.error('❌ Unknown token. Available:', Object.keys(TOKENS).join(', '));
    process.exit(1);
  }
  
  const amountIn = ethers.parseUnits(amount.toString(), fromToken.decimals);
  
  console.log(`🔍 Aggregator Quote: ${amount} ${fromSymbol} → ${toSymbol}\n`);
  
  const quotes = [];
  
  for (const dexKey of Object.keys(DEXES)) {
    const q = await getQuote(provider, dexKey, fromToken.address, toToken.address, amountIn);
    if (q) {
      quotes.push(q);
      const outFormatted = ethers.formatUnits(q.amountOut, toToken.decimals);
      console.log(`${q.dexName} (${q.fee/10000}%): ${outFormatted} ${toSymbol}`);
    }
  }
  
  if (quotes.length === 0) {
    console.log('❌ No routes found');
    return null;
  }
  
  // Find best
  const best = quotes.reduce((a, b) => a.amountOut > b.amountOut ? a : b);
  const bestOut = ethers.formatUnits(best.amountOut, toToken.decimals);
  
  console.log(`\n✅ Best: ${best.dexName} (${best.fee/10000}%) → ${bestOut} ${toSymbol}`);
  console.log(`   Rate: 1 ${fromSymbol} = ${(Number(bestOut) / Number(amount)).toFixed(6)} ${toSymbol}`);
  
  return best;
}

// ============ SWAP ============
async function swap(fromSymbol, toSymbol, amount, slippage, keystorePath) {
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  const provider = signer.provider;
  
  const fromToken = TOKENS[fromSymbol.toUpperCase()];
  const toToken = TOKENS[toSymbol.toUpperCase()];
  
  if (!fromToken || !toToken) {
    console.error('❌ Unknown token');
    process.exit(1);
  }
  
  const amountIn = ethers.parseUnits(amount.toString(), fromToken.decimals);
  slippage = slippage || 1;
  
  console.log(`🔄 Aggregator Swap: ${amount} ${fromSymbol} → ${toSymbol}`);
  console.log(`   Wallet: ${address}`);
  console.log(`   Slippage: ${slippage}%\n`);
  
  // Check balance
  const token = new ethers.Contract(fromToken.address, ERC20_ABI, provider);
  const balance = await token.balanceOf(address);
  if (balance < amountIn) {
    console.error(`❌ Insufficient ${fromSymbol}. Have: ${ethers.formatUnits(balance, fromToken.decimals)}`);
    process.exit(1);
  }
  
  // Get best quote
  console.log('📊 Getting quotes...');
  const quotes = [];
  
  for (const dexKey of Object.keys(DEXES)) {
    const q = await getQuote(provider, dexKey, fromToken.address, toToken.address, amountIn);
    if (q) {
      quotes.push(q);
      const outFormatted = ethers.formatUnits(q.amountOut, toToken.decimals);
      console.log(`   ${q.dexName}: ${outFormatted} ${toSymbol}`);
    }
  }
  
  if (quotes.length === 0) {
    console.error('❌ No routes found');
    process.exit(1);
  }
  
  const best = quotes.reduce((a, b) => a.amountOut > b.amountOut ? a : b);
  const amountOutMin = best.amountOut * BigInt(100 - slippage) / 100n;
  
  console.log(`\n✅ Best route: ${best.dexName} (${best.fee/10000}%)`);
  console.log(`   Expected: ${ethers.formatUnits(best.amountOut, toToken.decimals)} ${toSymbol}`);
  console.log(`   Min: ${ethers.formatUnits(amountOutMin, toToken.decimals)} ${toSymbol}`);
  
  // Approve if needed
  const router = best.dex === 'enosys' ? DEXES.enosys.router : DEXES.sparkdex.router;
  const tokenContract = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
  const allowance = await tokenContract.allowance(address, router);
  
  if (allowance < amountIn) {
    console.log('\n📝 Approving...');
    const approveTx = await tokenContract.approve(router, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Execute swap
  console.log('\n🔄 Executing swap...');
  try {
    let tx;
    if (best.dex === 'enosys') {
      tx = await swapEnosys(signer, fromToken.address, toToken.address, amountIn, amountOutMin, best.fee);
    } else {
      tx = await swapSparkDex(signer, fromToken.address, toToken.address, amountIn, amountOutMin, best.fee);
    }
    
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log(`\n✅ Swap Complete!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('\n❌ Swap failed:', err.message);
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
  
  if (!command || command === '--help') {
    console.log(`
DEX Aggregator for Flare
========================
Compares Enosys V3 and SparkDex V3.1, routes to best venue.

Usage:
  node aggregator.js quote <from> <to> <amount>
  node aggregator.js swap <from> <to> <amount> [--slippage N]

Examples:
  node aggregator.js quote WFLR FXRP 100
  node aggregator.js swap WFLR FXRP 100 --slippage 2

Tokens: ${Object.keys(TOKENS).join(', ')}
`);
    return;
  }
  
  const keystorePath = getArg('keystore') || DEFAULT_KEYSTORE;
  const slippage = parseFloat(getArg('slippage') || '1');
  
  if (command === 'quote') {
    await quote(args[1], args[2], args[3]);
  } else if (command === 'swap') {
    await swap(args[1], args[2], args[3], slippage, keystorePath);
  } else {
    console.error('Unknown command:', command);
  }
}

main().catch(console.error);
