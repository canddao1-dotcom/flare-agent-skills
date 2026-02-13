#!/usr/bin/env node
/**
 * Enosys V3 — Swap & Quote
 * Standard Uniswap V3 on Flare Network
 * 
 * Usage:
 *   node swap.js quote --from WFLR --to FXRP --amount 100 [--fee 3000]
 *   node swap.js swap  --from WFLR --to FXRP --amount 100 [--slippage 1] [--fee 3000]
 *   node swap.js pools
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;

const CONTRACTS = {
  SwapRouter: '0x5FD34090E9b195d8482Ad3CC63dB078534F1b113',
  QuoterV2:   '0xE505Bf33e84dDA2183cd0E4a6E8B084b85BC4269',
  Factory:    '0x17AA157AC8C54034381b840Cb8f6bf7Fc355f0de',
};

const TOKENS = {
  WFLR:  { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  FLR:   { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  FXRP:  { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', decimals: 6  },
  sFLR:  { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
  USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6  },
  CDP:   { address: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F', decimals: 18 },
  rFLR:  { address: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e', decimals: 18 },
  stXRP: { address: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', decimals: 6  },
};

// ── ABIs ────────────────────────────────────────────────────────────────────
const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)',
];

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function resolveToken(sym) {
  const upper = sym.toUpperCase();
  const t = TOKENS[upper];
  if (!t) {
    if (ethers.isAddress(sym)) return { address: ethers.getAddress(sym), decimals: null, symbol: sym };
    throw new Error(`Unknown token: ${sym}. Known: ${Object.keys(TOKENS).join(', ')}`);
  }
  return { ...t, symbol: upper };
}

function encodePath(tokens, fees) {
  // Standard Uniswap V3: address(20) + fee(3) + address(20) + fee(3) + ...
  if (tokens.length !== fees.length + 1) throw new Error('Invalid path length');
  const types = [];
  const values = [];
  for (let i = 0; i < tokens.length; i++) {
    types.push('address');
    values.push(tokens[i]);
    if (i < fees.length) {
      types.push('uint24');
      values.push(fees[i]);
    }
  }
  return ethers.solidityPacked(types, values);
}

function feeToPercent(fee) {
  return (Number(fee) / 10000).toFixed(2) + '%';
}

async function getProvider() {
  return new ethers.JsonRpcProvider(RPC, CHAIN_ID);
}

async function getSigner() {
  const provider = await getProvider();
  const keystorePath = process.env.AGENT_KEYSTORE || './keystore.json';
  const passwordPath = process.env.AGENT_KEYSTORE_PASSWORD;
  const passwordPath2 = process.env.KEYSTORE_PASSWORD_PATH || path.join(path.dirname(keystorePath), '.password');
  
  let password;
  if (passwordPath && fs.existsSync(passwordPath)) {
    password = fs.readFileSync(passwordPath, 'utf8').trim();
  } else if (passwordPath2 && fs.existsSync(passwordPath2)) {
    password = fs.readFileSync(passwordPath2, 'utf8').trim();
  }
  if (!password) throw new Error('No keystore password found. Set AGENT_KEYSTORE_PASSWORD or KEYSTORE_PASSWORD_PATH env var.');
  if (!fs.existsSync(keystorePath)) throw new Error(`Keystore not found: ${keystorePath}`);
  
  const json = fs.readFileSync(keystorePath, 'utf8');
  const wallet = await ethers.Wallet.fromEncryptedJson(json, password);
  return wallet.connect(provider);
}

// ── Quote ───────────────────────────────────────────────────────────────────
async function quote(args) {
  const fromToken = resolveToken(args.from);
  const toToken = resolveToken(args.to);
  const amount = ethers.parseUnits(String(args.amount), fromToken.decimals);
  const fee = parseInt(args.fee || '3000');
  const provider = await getProvider();
  const quoter = new ethers.Contract(CONTRACTS.QuoterV2, QUOTER_ABI, provider);

  const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn: fromToken.address,
    tokenOut: toToken.address,
    amountIn: amount,
    fee,
    sqrtPriceLimitX96: 0n,
  });
  
  const amountOut = result[0];
  const gasEst = result[3];
  const rate = Number(ethers.formatUnits(amountOut, toToken.decimals)) / Number(args.amount);
  
  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│         Enosys V3 — Quote                    │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  From:      ${(args.amount + ' ' + fromToken.symbol).padEnd(30)}│`);
  console.log(`│  To:        ${(ethers.formatUnits(amountOut, toToken.decimals) + ' ' + toToken.symbol).padEnd(30)}│`);
  console.log(`│  Rate:      1 ${fromToken.symbol} = ${rate.toFixed(6)} ${toToken.symbol}`.padEnd(46) + '│');
  console.log(`│  Fee:       ${feeToPercent(fee).padEnd(30)}│`);
  console.log(`│  Gas est:   ${gasEst.toString().padEnd(30)}│`);
  console.log('└─────────────────────────────────────────────┘\n');
  return { amountOut, fee };
}

// ── Best Quote (across fee tiers) ───────────────────────────────────────────
async function bestQuote(args) {
  const fromToken = resolveToken(args.from);
  const toToken = resolveToken(args.to);
  const amount = ethers.parseUnits(String(args.amount), fromToken.decimals);
  const provider = await getProvider();
  const quoter = new ethers.Contract(CONTRACTS.QuoterV2, QUOTER_ABI, provider);
  
  const fees = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
  let best = null;
  
  for (const fee of fees) {
    try {
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: fromToken.address, tokenOut: toToken.address,
        amountIn: amount, fee, sqrtPriceLimitX96: 0n,
      });
      if (!best || result[0] > best.amountOut) {
        best = { amountOut: result[0], fee, gasEst: result[3] };
      }
    } catch (e) { /* pool doesn't exist */ }
  }
  
  if (!best) { console.log('No pools found for this pair'); return null; }
  
  const rate = Number(ethers.formatUnits(best.amountOut, toToken.decimals)) / Number(args.amount);
  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│         Enosys V3 — Best Quote               │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  From:      ${(args.amount + ' ' + fromToken.symbol).padEnd(30)}│`);
  console.log(`│  To:        ${(ethers.formatUnits(best.amountOut, toToken.decimals) + ' ' + toToken.symbol).padEnd(30)}│`);
  console.log(`│  Rate:      1 ${fromToken.symbol} = ${rate.toFixed(6)} ${toToken.symbol}`.padEnd(46) + '│');
  console.log(`│  Best fee:  ${feeToPercent(best.fee).padEnd(30)}│`);
  console.log('└─────────────────────────────────────────────┘\n');
  return best;
}

// ── Pool Info ───────────────────────────────────────────────────────────────
async function poolInfo(args) {
  const token0 = resolveToken(args.from || args.token0);
  const token1 = resolveToken(args.to || args.token1);
  const fee = parseInt(args.fee || '3000');
  const provider = await getProvider();
  const factory = new ethers.Contract(CONTRACTS.Factory, FACTORY_ABI, provider);
  
  const fees = args.fee ? [fee] : [500, 3000, 10000];
  
  for (const f of fees) {
    const poolAddr = await factory.getPool(token0.address, token1.address, f);
    if (poolAddr === ethers.ZeroAddress) continue;
    
    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [slot0, liq, spacing] = await Promise.all([pool.slot0(), pool.liquidity(), pool.tickSpacing()]);
    
    console.log(`\n  ${token0.symbol}/${token1.symbol} — ${feeToPercent(f)} fee`);
    console.log(`  Pool:      ${poolAddr}`);
    console.log(`  Tick:      ${slot0.tick}`);
    console.log(`  Liquidity: ${liq.toString()}`);
    console.log(`  Spacing:   ${spacing}`);
  }
  console.log();
}

// ── Swap ────────────────────────────────────────────────────────────────────
async function swap(args) {
  const fromToken = resolveToken(args.from);
  const toToken = resolveToken(args.to);
  const amount = ethers.parseUnits(String(args.amount), fromToken.decimals);
  const slippage = parseFloat(args.slippage || '0.5');
  const fee = parseInt(args.fee || '3000');
  
  const signer = await getSigner();
  const myAddress = await signer.getAddress();
  const provider = signer.provider;
  
  // 1. Get quote
  console.log(`\nGetting quote for ${args.amount} ${fromToken.symbol} → ${toToken.symbol}...`);
  const quoter = new ethers.Contract(CONTRACTS.QuoterV2, QUOTER_ABI, provider);
  const qr = await quoter.quoteExactInputSingle.staticCall({
    tokenIn: fromToken.address, tokenOut: toToken.address,
    amountIn: amount, fee, sqrtPriceLimitX96: 0n,
  });
  
  const expectedOut = qr[0];
  const minOut = expectedOut * BigInt(Math.floor((100 - slippage) * 100)) / 10000n;
  
  console.log(`  Expected:  ${ethers.formatUnits(expectedOut, toToken.decimals)} ${toToken.symbol}`);
  console.log(`  Min out:   ${ethers.formatUnits(minOut, toToken.decimals)} ${toToken.symbol} (${slippage}% slippage)`);
  
  // 2. Approve
  const tokenIn = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
  const allowance = await tokenIn.allowance(myAddress, CONTRACTS.SwapRouter);
  if (allowance < amount) {
    console.log('  Approving token spend...');
    const atx = await tokenIn.approve(CONTRACTS.SwapRouter, ethers.MaxUint256);
    await atx.wait();
    console.log('  ✓ Approved');
  }
  
  // 3. Execute
  const router = new ethers.Contract(CONTRACTS.SwapRouter, ROUTER_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  
  console.log('  Sending swap...');
  const tx = await router.exactInputSingle({
    tokenIn: fromToken.address,
    tokenOut: toToken.address,
    fee,
    recipient: myAddress,
    deadline,
    amountIn: amount,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  });
  
  console.log(`  Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✓ Confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed.toString()})\n`);
  return receipt;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else {
      positional.push(argv[i]);
    }
  }
  args._cmd = positional[0];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  
  try {
    switch (args._cmd) {
      case 'quote':
        if (!args.from || !args.to || !args.amount) {
          console.log('Usage: node swap.js quote --from TOKEN --to TOKEN --amount NUM [--fee 3000]');
          process.exit(1);
        }
        await quote(args);
        break;
      case 'best':
        if (!args.from || !args.to || !args.amount) {
          console.log('Usage: node swap.js best --from TOKEN --to TOKEN --amount NUM');
          process.exit(1);
        }
        await bestQuote(args);
        break;
      case 'swap':
        if (!args.from || !args.to || !args.amount) {
          console.log('Usage: node swap.js swap --from TOKEN --to TOKEN --amount NUM [--slippage PCT] [--fee 3000]');
          process.exit(1);
        }
        await swap(args);
        break;
      case 'pool':
      case 'pools':
        if (!args.from || !args.to) {
          console.log('Usage: node swap.js pool --from TOKEN --to TOKEN [--fee 3000]');
          process.exit(1);
        }
        await poolInfo(args);
        break;
      default:
        console.log('Enosys V3 Swap — Uniswap V3 on Flare\n');
        console.log('Commands:');
        console.log('  quote  --from TOKEN --to TOKEN --amount NUM [--fee 3000]');
        console.log('  best   --from TOKEN --to TOKEN --amount NUM');
        console.log('  swap   --from TOKEN --to TOKEN --amount NUM [--slippage PCT] [--fee 3000]');
        console.log('  pool   --from TOKEN --to TOKEN [--fee 3000]');
        console.log('\nFee tiers: 500 (0.05%), 3000 (0.3%), 10000 (1%)');
        console.log('Tokens:', Object.keys(TOKENS).filter(t => t !== 'FLR').join(', '));
    }
  } catch (err) {
    console.error(`\n✗ Error: ${err.message || err}`);
    if (err.data) console.error('  Data:', err.data);
    process.exit(1);
  }
}

main();
