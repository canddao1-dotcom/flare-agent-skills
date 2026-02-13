#!/usr/bin/env node
/**
 * Swap Script for FlareBank
 * 
 * Based on ai-miguel swap_provider.py patterns
 * Executes swaps via Uniswap V3 style routers (Enosys/SparkDex)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// Configuration
const FLARE_RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';

// Load ABIs
const quoterAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '../abi/QuoterV2.json')));
const routerAbi = JSON.parse(fs.readFileSync(path.join(__dirname, '../abi/SwapRouter.json')));

// DEX Configurations
const DEX_CONFIG = {
  enosys: {
    quoter: '0x0A32EE3f66cC9E68ffb7cBeCf77bAef03e2d7C56',
    router: '0x9D3DE1C1609BbdE64e36a0C7082E2530a0f5a95B',
    factory: '0x17AA157AC8C54034381b840Cb8f6bf7Fc355f0de'
  },
  sparkdex: {
    quoter: '0x0A32EE3f66cC9E68ffb7cBeCf77bAef03e2d7C56', // May need updating
    router: '0x7a57DF6665B5b4B9f8C555e19502333D0B89aD59',
    factory: '0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652'
  }
};

// Token Addresses
const TOKENS = {
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
  BANK: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059',
  FXRP: '0xad552a648c74d49e10027ab8a618a3ad4901c5be',
  sFLR: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB',
  USDT: '0x0B38e83B86d491735fEaa0a791F65c2B99535396', // eUSDT on Flare
  HLN: '0x140D8d3649Ec605CF69018C627fB44cCC76eC89f'
};

// ERC20 ABI
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

/**
 * Encode path for V3 multi-hop swaps
 * Format: token0 + fee + token1 + fee + token2 ...
 */
function encodePath(tokens, fees) {
  if (tokens.length !== fees.length + 1) {
    throw new Error('Invalid path: tokens.length must equal fees.length + 1');
  }
  
  let path = tokens[0].toLowerCase().slice(2);
  for (let i = 0; i < fees.length; i++) {
    path += fees[i].toString(16).padStart(6, '0');
    path += tokens[i + 1].toLowerCase().slice(2);
  }
  return '0x' + path;
}

/**
 * Get quote for a swap
 */
async function getQuote(provider, dex, tokenIn, tokenOut, amountIn, fee = 3000) {
  const config = DEX_CONFIG[dex];
  if (!config) throw new Error(`Unknown DEX: ${dex}`);
  
  const quoter = new ethers.Contract(config.quoter, quoterAbi, provider);
  
  // Single-hop path
  const path = encodePath([tokenIn, tokenOut], [fee]);
  
  try {
    const result = await quoter.quoteExactInput.staticCall(path, amountIn);
    return {
      amountOut: result[0],
      sqrtPriceX96After: result[1],
      ticksCrossed: result[2],
      gasEstimate: result[3]
    };
  } catch (error) {
    console.error('Quote error:', error.message);
    return null;
  }
}

/**
 * Execute a swap
 */
async function executeSwap(signer, dex, tokenIn, tokenOut, amountIn, amountOutMin, fee = 3000) {
  const config = DEX_CONFIG[dex];
  if (!config) throw new Error(`Unknown DEX: ${dex}`);
  
  const provider = signer.provider;
  const walletAddress = await signer.getAddress();
  
  // Check and set allowance
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, signer);
  const currentAllowance = await tokenContract.allowance(walletAddress, config.router);
  
  if (currentAllowance < amountIn) {
    console.log('Approving router to spend tokens...');
    const approveTx = await tokenContract.approve(config.router, ethers.MaxUint256);
    await approveTx.wait();
    console.log('Approval confirmed');
  }
  
  // Build swap transaction
  const router = new ethers.Contract(config.router, routerAbi, signer);
  const path = encodePath([tokenIn, tokenOut], [fee]);
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  
  const params = {
    path: path,
    recipient: walletAddress,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin
  };
  
  console.log('Executing swap...');
  const tx = await router.exactInput(params);
  const receipt = await tx.wait();
  
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString()
  };
}

/**
 * Wrap native FLR to WFLR
 */
async function wrapFLR(signer, amount) {
  const WFLR_ABI = [
    'function deposit() payable',
    'function withdraw(uint256 amount)'
  ];
  
  const wflr = new ethers.Contract(TOKENS.WFLR, WFLR_ABI, signer);
  const tx = await wflr.deposit({ value: amount });
  const receipt = await tx.wait();
  
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber
  };
}

/**
 * Unwrap WFLR to native FLR
 */
async function unwrapFLR(signer, amount) {
  const WFLR_ABI = [
    'function deposit() payable',
    'function withdraw(uint256 amount)'
  ];
  
  const wflr = new ethers.Contract(TOKENS.WFLR, WFLR_ABI, signer);
  const tx = await wflr.withdraw(amount);
  const receipt = await tx.wait();
  
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber
  };
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length < 1) {
    console.log(`
Usage: node swap.js <command> [options]

Commands:
  quote     Get a swap quote
  swap      Execute a swap
  wrap      Wrap FLR to WFLR
  unwrap    Unwrap WFLR to FLR

Options:
  --keystore <path>   Path to wallet keystore JSON
  --dex <name>        DEX to use (enosys|sparkdex), default: enosys
  --from <token>      Input token symbol or address
  --to <token>        Output token symbol or address
  --amount <num>      Amount to swap (human readable)
  --slippage <pct>    Slippage percentage, default: 0.5
  --fee <num>         Pool fee tier, default: 3000
  --dry-run           Show quote without executing

Examples:
  # Get quote for swapping 100 WFLR to BANK
  node swap.js quote --from WFLR --to BANK --amount 100 --dex enosys
  
  # Execute swap with 1% slippage
  node swap.js swap --keystore wallet.json --from WFLR --to BANK --amount 100 --slippage 1
  
  # Wrap 10 FLR to WFLR
  node swap.js wrap --keystore wallet.json --amount 10
`);
    return;
  }
  
  const command = args[0];
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  const dex = getArg('dex') || 'enosys';
  const fromToken = getArg('from');
  const toToken = getArg('to');
  const amount = getArg('amount');
  const slippage = parseFloat(getArg('slippage') || '0.5') / 100;
  const fee = parseInt(getArg('fee') || '3000');
  const keystorePath = getArg('keystore');
  const dryRun = args.includes('--dry-run');
  
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);
  
  // Resolve token addresses
  const resolveToken = (token) => {
    if (!token) return null;
    if (token.startsWith('0x')) return token;
    return TOKENS[token.toUpperCase()] || null;
  };
  
  const tokenInAddr = resolveToken(fromToken);
  const tokenOutAddr = resolveToken(toToken);
  
  // Get token decimals for amount conversion
  async function getDecimals(address) {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    return await contract.decimals();
  }
  
  if (command === 'quote') {
    if (!tokenInAddr || !tokenOutAddr || !amount) {
      console.error('Missing required options: --from, --to, --amount');
      process.exit(1);
    }
    
    const decimals = await getDecimals(tokenInAddr);
    const amountIn = ethers.parseUnits(amount, decimals);
    
    console.log(`\n📊 Getting quote on ${dex}...`);
    console.log(`   ${amount} ${fromToken} → ${toToken}`);
    
    const quote = await getQuote(provider, dex, tokenInAddr, tokenOutAddr, amountIn, fee);
    
    if (quote) {
      const outDecimals = await getDecimals(tokenOutAddr);
      const amountOut = ethers.formatUnits(quote.amountOut, outDecimals);
      
      console.log(`\n✅ Quote received:`);
      console.log(`   Amount out: ${amountOut} ${toToken}`);
      console.log(`   Rate: 1 ${fromToken} = ${(parseFloat(amountOut) / parseFloat(amount)).toFixed(6)} ${toToken}`);
      console.log(`   Gas estimate: ${quote.gasEstimate.toString()}`);
    } else {
      console.log('❌ Could not get quote. Pool may not exist for this pair/fee.');
    }
    
  } else if (command === 'swap') {
    if (!keystorePath) {
      console.error('Missing required option: --keystore');
      process.exit(1);
    }
    if (!tokenInAddr || !tokenOutAddr || !amount) {
      console.error('Missing required options: --from, --to, --amount');
      process.exit(1);
    }
    
    // Load wallet
    const walletData = JSON.parse(fs.readFileSync(keystorePath));
    const signer = new ethers.Wallet(walletData.privateKey, provider);
    
    const decimals = await getDecimals(tokenInAddr);
    const amountIn = ethers.parseUnits(amount, decimals);
    
    // Get quote first
    console.log(`\n📊 Getting quote on ${dex}...`);
    const quote = await getQuote(provider, dex, tokenInAddr, tokenOutAddr, amountIn, fee);
    
    if (!quote) {
      console.error('❌ Could not get quote');
      process.exit(1);
    }
    
    const outDecimals = await getDecimals(tokenOutAddr);
    const amountOut = ethers.formatUnits(quote.amountOut, outDecimals);
    const amountOutMin = quote.amountOut * BigInt(Math.floor((1 - slippage) * 10000)) / 10000n;
    const minOut = ethers.formatUnits(amountOutMin, outDecimals);
    
    console.log(`   Expected: ${amountOut} ${toToken}`);
    console.log(`   Min (${slippage * 100}% slippage): ${minOut} ${toToken}`);
    
    if (dryRun) {
      console.log('\n🔍 Dry run - not executing');
      return;
    }
    
    console.log(`\n🔄 Executing swap...`);
    const result = await executeSwap(signer, dex, tokenInAddr, tokenOutAddr, amountIn, amountOutMin, fee);
    
    console.log(`\n✅ Swap complete!`);
    console.log(`   Tx: ${result.hash}`);
    console.log(`   Block: ${result.blockNumber}`);
    console.log(`   Gas used: ${result.gasUsed}`);
    
  } else if (command === 'wrap') {
    if (!keystorePath || !amount) {
      console.error('Missing required options: --keystore, --amount');
      process.exit(1);
    }
    
    const walletData = JSON.parse(fs.readFileSync(keystorePath));
    const signer = new ethers.Wallet(walletData.privateKey, provider);
    const amountWei = ethers.parseEther(amount);
    
    if (dryRun) {
      console.log(`\n🔍 Would wrap ${amount} FLR to WFLR`);
      return;
    }
    
    console.log(`\n🔄 Wrapping ${amount} FLR to WFLR...`);
    const result = await wrapFLR(signer, amountWei);
    
    console.log(`✅ Wrapped!`);
    console.log(`   Tx: ${result.hash}`);
    
  } else if (command === 'unwrap') {
    if (!keystorePath || !amount) {
      console.error('Missing required options: --keystore, --amount');
      process.exit(1);
    }
    
    const walletData = JSON.parse(fs.readFileSync(keystorePath));
    const signer = new ethers.Wallet(walletData.privateKey, provider);
    const amountWei = ethers.parseEther(amount);
    
    if (dryRun) {
      console.log(`\n🔍 Would unwrap ${amount} WFLR to FLR`);
      return;
    }
    
    console.log(`\n🔄 Unwrapping ${amount} WFLR to FLR...`);
    const result = await unwrapFLR(signer, amountWei);
    
    console.log(`✅ Unwrapped!`);
    console.log(`   Tx: ${result.hash}`);
    
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main().catch(console.error);

// Export for programmatic use
module.exports = {
  getQuote,
  executeSwap,
  wrapFLR,
  unwrapFLR,
  encodePath,
  TOKENS,
  DEX_CONFIG
};
