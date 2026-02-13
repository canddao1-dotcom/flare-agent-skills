#!/usr/bin/env node
/**
 * SparkDex V4 (Algebra Integral) — Swap & Quote
 * Flare Network
 * 
 * Usage:
 *   node swap.js quote --from WFLR --to FXRP --amount 100
 *   node swap.js quote --from WFLR --to FXRP --amount 100 --via sFLR
 *   node swap.js swap  --from WFLR --to FXRP --amount 100 --slippage 1
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const RPC = 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;

const CONTRACTS = {
  SwapRouter: '0x69D57B9D705eaD73a5d2f2476C30c55bD755cc2F',
  QuoterV2:   '0x6AD6A4f233F1E33613e996CCc17409B93fF8bf5f',
  Factory:    '0x805488DaA81c1b9e7C5cE3f1DCeA28F21448EC6A',
};

const TOKENS = {
  WFLR:  { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  FLR:   { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 }, // alias
  FXRP:  { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', decimals: 6  },
  sFLR:  { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
  USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6  },
  CDP:   { address: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F', decimals: 18 },
  stXRP: { address: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', decimals: 6  },
};

// ── ABIs ────────────────────────────────────────────────────────────────────
const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, address deployer, uint256 amountIn, uint160 limitSqrtPrice)) external returns (uint256 amountOut, uint16 fee, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate)',
];

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, address deployer, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice)) external payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function refundNativeToken() external payable',
  'function unwrapWNativeToken(uint256 amountMinimum, address recipient) external payable',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
];

const POOL_ABI = [
  'function globalState() external view returns (uint160 price, int24 tick, uint16 lastFee, uint8 pluginConfig, uint16 communityFee, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function tickSpacing() external view returns (int24)',
];

const FACTORY_ABI = [
  'function poolByPair(address tokenA, address tokenB) external view returns (address pool)',
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function resolveToken(sym) {
  const upper = sym.toUpperCase();
  const t = TOKENS[upper] || TOKENS[sym] || Object.values(TOKENS).find((_, i) => Object.keys(TOKENS)[i].toUpperCase() === upper);
  if (!t) {
    // Try as address
    if (ethers.isAddress(sym)) return { address: ethers.getAddress(sym), decimals: null, symbol: sym };
    throw new Error(`Unknown token: ${sym}. Known: ${Object.keys(TOKENS).join(', ')}`);
  }
  return { ...t, symbol: upper };
}

function encodePath(addresses) {
  // Algebra Integral: address(20) + deployer(20) + address(20) + deployer(20) + ...
  // deployer = address(0) means use default pool deployer
  const parts = [];
  const types = [];
  for (let i = 0; i < addresses.length; i++) {
    types.push('address');
    parts.push(addresses[i]);
    if (i < addresses.length - 1) {
      types.push('address');
      parts.push(ethers.ZeroAddress); // default deployer
    }
  }
  return ethers.solidityPacked(types, parts);
}

function feeToPercent(fee) {
  // fee is in hundredths of a bip (1e-6)
  return (Number(fee) / 10000).toFixed(4) + '%';
}

function formatAmount(amount, decimals) {
  return ethers.formatUnits(amount, decimals);
}

function parseAmount(amount, decimals) {
  return ethers.parseUnits(String(amount), decimals);
}

async function getProvider() {
  return new ethers.JsonRpcProvider(RPC, CHAIN_ID);
}

async function getSigner() {
  const provider = await getProvider();
  const keystorePath = process.env.AGENT_KEYSTORE || './keystore.json';
  const passwordPath = process.env.AGENT_KEYSTORE_PASSWORD;
  
  let password;
  if (passwordPath && fs.existsSync(passwordPath)) {
    password = fs.readFileSync(passwordPath, 'utf8').trim();
  } else {
    // Try common locations
    const candidates = [
      '~/.agent-keystore-password',
      path.join(path.dirname(keystorePath), '.password'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { password = fs.readFileSync(c, 'utf8').trim(); break; }
    }
  }
  
  if (!password) throw new Error('No keystore password found. Set AGENT_KEYSTORE_PASSWORD env var.');
  if (!fs.existsSync(keystorePath)) throw new Error(`Keystore not found: ${keystorePath}`);
  
  const json = fs.readFileSync(keystorePath, 'utf8');
  const wallet = await ethers.Wallet.fromEncryptedJson(json, password);
  return wallet.connect(provider);
}

// ── Quote ───────────────────────────────────────────────────────────────────
async function quote(args) {
  const fromToken = resolveToken(args.from);
  const toToken = resolveToken(args.to);
  const amount = parseAmount(args.amount, fromToken.decimals);
  const provider = await getProvider();
  const quoter = new ethers.Contract(CONTRACTS.QuoterV2, QUOTER_ABI, provider);

  const via = args.via ? args.via.split(',').map(s => resolveToken(s.trim())) : null;
  
  let result;
  if (via && via.length > 0) {
    // Multi-hop
    const addresses = [fromToken.address, ...via.map(t => t.address), toToken.address];
    const pathBytes = encodePath(addresses);
    result = await quoter.quoteExactInput.staticCall(pathBytes, amount);
    
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log('│         SparkDex V4 — Multi-hop Quote        │');
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│  Path:      ${[fromToken.symbol, ...via.map(v => v.symbol), toToken.symbol].join(' → ').padEnd(30)}│`);
    console.log(`│  Input:     ${formatAmount(amount, fromToken.decimals).padEnd(30)}│`);
    console.log(`│  Output:    ${formatAmount(result[0], toToken.decimals).padEnd(30)}│`);
    console.log(`│  Gas est:   ${result[3].toString().padEnd(30)}│`);
    console.log('└─────────────────────────────────────────────┘\n');
    return { amountOut: result[0] };
  } else {
    // Single hop
    result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: fromToken.address,
      tokenOut: toToken.address,
      deployer: ethers.ZeroAddress,
      amountIn: amount,
      limitSqrtPrice: 0n,
    });
    
    const amountOut = result[0];
    const fee = result[1];
    const gasEst = result[4];
    const rate = Number(formatAmount(amountOut, toToken.decimals)) / Number(args.amount);
    console.log('\n┌─────────────────────────────────────────────┐');
    console.log('│         SparkDex V4 — Quote                  │');
    console.log('├─────────────────────────────────────────────┤');
    console.log(`│  From:      ${(args.amount + ' ' + fromToken.symbol).padEnd(30)}│`);
    console.log(`│  To:        ${(formatAmount(amountOut, toToken.decimals) + ' ' + toToken.symbol).padEnd(30)}│`);
    console.log(`│  Rate:      1 ${fromToken.symbol} = ${rate.toFixed(6)} ${toToken.symbol}`.padEnd(46) + '│');
    console.log(`│  Fee:       ${feeToPercent(fee).padEnd(30)}│`);
    console.log(`│  Gas est:   ${gasEst.toString().padEnd(30)}│`);
    console.log('└─────────────────────────────────────────────┘\n');
    return { amountOut, fee };
  }
}

// ── Pool Info ───────────────────────────────────────────────────────────────
async function poolInfo(args) {
  const token0 = resolveToken(args.from || args.token0);
  const token1 = resolveToken(args.to || args.token1);
  const provider = await getProvider();
  const factory = new ethers.Contract(CONTRACTS.Factory, FACTORY_ABI, provider);
  
  const poolAddr = await factory.poolByPair(token0.address, token1.address);
  if (poolAddr === ethers.ZeroAddress) {
    console.log(`No pool found for ${token0.symbol}/${token1.symbol}`);
    return;
  }
  
  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  const [state, liq, spacing] = await Promise.all([
    pool.globalState(),
    pool.liquidity(),
    pool.tickSpacing(),
  ]);
  
  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│         SparkDex V4 — Pool Info              │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  Pool:      ${poolAddr.slice(0, 20)}...`.padEnd(46) + '│');
  console.log(`│  Pair:      ${token0.symbol}/${token1.symbol}`.padEnd(46) + '│');
  console.log(`│  Tick:      ${state.tick.toString().padEnd(30)}│`);
  console.log(`│  Fee:       ${feeToPercent(state.lastFee).padEnd(30)}│`);
  console.log(`│  Liquidity: ${liq.toString().padEnd(30)}│`);
  console.log(`│  Spacing:   ${spacing.toString().padEnd(30)}│`);
  console.log('└─────────────────────────────────────────────┘\n');
}

// ── Swap ────────────────────────────────────────────────────────────────────
async function swap(args) {
  const fromToken = resolveToken(args.from);
  const toToken = resolveToken(args.to);
  const amount = parseAmount(args.amount, fromToken.decimals);
  const slippage = parseFloat(args.slippage || '0.5'); // default 0.5%
  
  const signer = await getSigner();
  const myAddress = await signer.getAddress();
  const provider = signer.provider;
  
  // 1. Get quote first
  console.log(`\nGetting quote for ${args.amount} ${fromToken.symbol} → ${toToken.symbol}...`);
  const quoter = new ethers.Contract(CONTRACTS.QuoterV2, QUOTER_ABI, provider);
  
  const via = args.via ? args.via.split(',').map(s => resolveToken(s.trim())) : null;
  let expectedOut, fees;
  
  if (via && via.length > 0) {
    const addresses = [fromToken.address, ...via.map(t => t.address), toToken.address];
    const pathBytes = encodePath(addresses);
    const qr = await quoter.quoteExactInput.staticCall(pathBytes, amount);
    expectedOut = qr[0];
    fees = 'dynamic';
  } else {
    const qr = await quoter.quoteExactInputSingle.staticCall({
      tokenIn: fromToken.address, tokenOut: toToken.address,
      deployer: ethers.ZeroAddress,
      amountIn: amount, limitSqrtPrice: 0n,
    });
    expectedOut = qr[0];
    fees = feeToPercent(qr[1]);
  }
  
  const minOut = expectedOut * BigInt(Math.floor((100 - slippage) * 100)) / 10000n;
  
  console.log(`  Expected:  ${formatAmount(expectedOut, toToken.decimals)} ${toToken.symbol}`);
  console.log(`  Min out:   ${formatAmount(minOut, toToken.decimals)} ${toToken.symbol} (${slippage}% slippage)`);
  console.log(`  Fee:       ${fees}`);
  
  // 2. Check/set approval
  const tokenIn = new ethers.Contract(fromToken.address, ERC20_ABI, signer);
  const allowance = await tokenIn.allowance(myAddress, CONTRACTS.SwapRouter);
  if (allowance < amount) {
    console.log('  Approving token spend...');
    const atx = await tokenIn.approve(CONTRACTS.SwapRouter, ethers.MaxUint256);
    await atx.wait();
    console.log('  ✓ Approved');
  }
  
  // 3. Execute swap
  const router = new ethers.Contract(CONTRACTS.SwapRouter, ROUTER_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  
  let tx;
  if (via && via.length > 0) {
    const addresses = [fromToken.address, ...via.map(t => t.address), toToken.address];
    const pathBytes = encodePath(addresses);
    console.log('  Sending multi-hop swap...');
    tx = await router.exactInput({
      path: pathBytes,
      recipient: myAddress,
      deadline,
      amountIn: amount,
      amountOutMinimum: minOut,
    });
  } else {
    console.log('  Sending swap...');
    tx = await router.exactInputSingle({
      tokenIn: fromToken.address,
      tokenOut: toToken.address,
      deployer: ethers.ZeroAddress,
      recipient: myAddress,
      deadline,
      amountIn: amount,
      amountOutMinimum: minOut,
      limitSqrtPrice: 0n,
    });
  }
  
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
          console.log('Usage: node swap.js quote --from TOKEN --to TOKEN --amount NUM [--via TOKEN,TOKEN]');
          process.exit(1);
        }
        await quote(args);
        break;
        
      case 'swap':
        if (!args.from || !args.to || !args.amount) {
          console.log('Usage: node swap.js swap --from TOKEN --to TOKEN --amount NUM [--slippage PCT] [--via TOKEN,TOKEN]');
          process.exit(1);
        }
        await swap(args);
        break;
        
      case 'pool':
        if (!args.from || !args.to) {
          console.log('Usage: node swap.js pool --from TOKEN --to TOKEN');
          process.exit(1);
        }
        await poolInfo(args);
        break;
        
      default:
        console.log('SparkDex V4 Swap — Algebra Integral on Flare\n');
        console.log('Commands:');
        console.log('  quote  --from TOKEN --to TOKEN --amount NUM [--via TOKEN,...]');
        console.log('  swap   --from TOKEN --to TOKEN --amount NUM [--slippage PCT] [--via TOKEN,...]');
        console.log('  pool   --from TOKEN --to TOKEN');
        console.log('\nTokens:', Object.keys(TOKENS).filter(t => t !== 'FLR').join(', '));
    }
  } catch (err) {
    console.error(`\n✗ Error: ${err.message || err}`);
    if (err.data) console.error('  Data:', err.data);
    process.exit(1);
  }
}

main();
