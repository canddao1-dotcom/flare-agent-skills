#!/usr/bin/env node
/**
 * Enosys V3 — LP Position Management
 * Standard Uniswap V3 on Flare Network
 * 
 * Usage:
 *   node lp.js positions --address 0x...
 *   node lp.js check     --address 0x...
 *   node lp.js mint      --token0 WFLR --token1 FXRP --amount0 1000 --amount1 100 --fee 3000 --range 10
 *   node lp.js add       --tokenId 123 --amount0 100 --amount1 10
 *   node lp.js remove    --tokenId 123 --percent 100
 *   node lp.js collect   --tokenId 123
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const RPC = process.env.FLARE_RPC || 'https://flare-api.flare.network/ext/C/rpc';
const CHAIN_ID = 14;

const CONTRACTS = {
  NonfungiblePositionManager: '0xd9770b1c7a6ccd33c75b5bcb1c0078f46be46657',
  Factory: '0x17AA157AC8C54034381b840Cb8f6bf7Fc355f0de',
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

const TOKEN_BY_ADDR = {};
for (const [sym, t] of Object.entries(TOKENS)) {
  TOKEN_BY_ADDR[t.address.toLowerCase()] = { ...t, symbol: sym };
}

// ── ABIs ────────────────────────────────────────────────────────────────────
const NFPM_ABI = [
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)',
  'function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)',
  'function burn(uint256 tokenId) external payable',
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

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
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

function tokenSymbol(addr) {
  const t = TOKEN_BY_ADDR[addr.toLowerCase()];
  return t ? t.symbol : addr.slice(0, 8) + '...';
}

function tokenDecimals(addr) {
  const t = TOKEN_BY_ADDR[addr.toLowerCase()];
  return t ? t.decimals : 18;
}

function feeToPercent(fee) {
  return (Number(fee) / 10000).toFixed(2) + '%';
}

function tickToPrice(tick, decimals0, decimals1) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
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

// ── Fetch positions ─────────────────────────────────────────────────────────
async function fetchPositions(address, provider) {
  const nfpm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NFPM_ABI, provider);
  const factory = new ethers.Contract(CONTRACTS.Factory, FACTORY_ABI, provider);
  
  const balance = await nfpm.balanceOf(address);
  const count = Number(balance);
  if (count === 0) return [];
  
  const positions = [];
  for (let i = 0; i < count; i++) {
    const tokenId = await nfpm.tokenOfOwnerByIndex(address, i);
    const pos = await nfpm.positions(tokenId);
    
    // Get pool state
    const poolAddr = await factory.getPool(pos.token0, pos.token1, pos.fee);
    let poolState = null, tickSpacing = 60;
    if (poolAddr !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
      [poolState, tickSpacing] = await Promise.all([pool.slot0(), pool.tickSpacing()]);
    }
    
    positions.push({
      tokenId: tokenId.toString(),
      token0: pos.token0,
      token1: pos.token1,
      fee: Number(pos.fee),
      tickLower: Number(pos.tickLower),
      tickUpper: Number(pos.tickUpper),
      liquidity: pos.liquidity,
      tokensOwed0: pos.tokensOwed0,
      tokensOwed1: pos.tokensOwed1,
      poolAddress: poolAddr,
      currentTick: poolState ? Number(poolState.tick) : null,
      tickSpacing: Number(tickSpacing),
    });
  }
  return positions;
}

// ── Health status ───────────────────────────────────────────────────────────
function positionHealth(pos) {
  if (pos.liquidity === 0n) return { status: '⚫ EMPTY', color: 'empty' };
  if (pos.currentTick === null) return { status: '❓ UNKNOWN', color: 'unknown' };
  
  const tick = pos.currentTick;
  const range = pos.tickUpper - pos.tickLower;
  const distLower = tick - pos.tickLower;
  const distUpper = pos.tickUpper - tick;
  
  if (tick < pos.tickLower || tick >= pos.tickUpper) {
    return { status: '🔴 OUT OF RANGE', color: 'red' };
  }
  
  const pctFromEdge = Math.min(distLower, distUpper) / range;
  if (pctFromEdge < 0.10) return { status: '🟡 NEAR EDGE', color: 'yellow' };
  return { status: '🟢 IN RANGE', color: 'green' };
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdPositions(args) {
  const address = args.address || process.env.AGENT_WALLET;
  if (!address) { console.log('Usage: node lp.js positions --address 0x...'); process.exit(1); }
  
  const provider = await getProvider();
  const positions = await fetchPositions(address, provider);
  
  if (positions.length === 0) {
    console.log(`\nNo Enosys V3 positions found for ${address}\n`);
    return;
  }
  
  console.log(`\n Enosys V3 Positions for ${address.slice(0, 8)}...${address.slice(-6)}`);
  console.log('─'.repeat(95));
  console.log(
    'ID'.padEnd(8) + 'Pair'.padEnd(16) + 'Fee'.padEnd(8) +
    'Range'.padEnd(30) + 'Liquidity'.padEnd(18) + 'Status'
  );
  console.log('─'.repeat(95));
  
  for (const pos of positions) {
    const sym0 = tokenSymbol(pos.token0);
    const sym1 = tokenSymbol(pos.token1);
    const dec0 = tokenDecimals(pos.token0);
    const dec1 = tokenDecimals(pos.token1);
    const pLow = tickToPrice(pos.tickLower, dec0, dec1);
    const pHigh = tickToPrice(pos.tickUpper, dec0, dec1);
    const health = positionHealth(pos);
    
    console.log(
      pos.tokenId.padEnd(8) +
      `${sym0}/${sym1}`.padEnd(16) +
      feeToPercent(pos.fee).padEnd(8) +
      `${pLow.toPrecision(5)} - ${pHigh.toPrecision(5)}`.padEnd(30) +
      pos.liquidity.toString().slice(0, 16).padEnd(18) +
      health.status
    );
    
    if (pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n) {
      console.log(
        ''.padEnd(8) +
        `  Uncollected: ${ethers.formatUnits(pos.tokensOwed0, dec0)} ${sym0}, ${ethers.formatUnits(pos.tokensOwed1, dec1)} ${sym1}`
      );
    }
  }
  console.log('─'.repeat(95) + '\n');
}

async function cmdCheck(args) {
  const address = args.address || process.env.AGENT_WALLET;
  if (!address) { console.log('Usage: node lp.js check --address 0x...'); process.exit(1); }
  
  const provider = await getProvider();
  const positions = await fetchPositions(address, provider);
  
  if (positions.length === 0) {
    console.log(`\nNo positions found for ${address}\n`);
    return;
  }
  
  let alerts = 0;
  console.log(`\n Enosys V3 Health Check — ${positions.length} position(s)`);
  console.log('─'.repeat(70));
  
  for (const pos of positions) {
    const sym0 = tokenSymbol(pos.token0);
    const sym1 = tokenSymbol(pos.token1);
    const health = positionHealth(pos);
    if (health.color === 'red' || health.color === 'yellow') alerts++;
    
    const dec0 = tokenDecimals(pos.token0);
    const dec1 = tokenDecimals(pos.token1);
    const curPrice = pos.currentTick !== null ? tickToPrice(pos.currentTick, dec0, dec1) : null;
    const pLow = tickToPrice(pos.tickLower, dec0, dec1);
    const pHigh = tickToPrice(pos.tickUpper, dec0, dec1);
    
    console.log(`  #${pos.tokenId}  ${sym0}/${sym1} (${feeToPercent(pos.fee)})  ${health.status}`);
    if (curPrice !== null) {
      console.log(`    Price: ${curPrice.toPrecision(5)}  Range: [${pLow.toPrecision(5)}, ${pHigh.toPrecision(5)}]`);
    }
  }
  
  console.log('─'.repeat(70));
  if (alerts > 0) console.log(`  ⚠️  ${alerts} position(s) need attention!\n`);
  else console.log(`  ✅ All positions healthy\n`);
}

async function cmdMint(args) {
  if (!args.token0 || !args.token1 || !args.amount0 || !args.amount1) {
    console.log('Usage: node lp.js mint --token0 WFLR --token1 FXRP --amount0 1000 --amount1 100 [--fee 3000] [--range 10] [--tickLower N --tickUpper N]');
    process.exit(1);
  }
  
  const t0 = resolveToken(args.token0);
  const t1 = resolveToken(args.token1);
  const fee = parseInt(args.fee || '3000');
  
  // Sort tokens
  let token0, token1, amount0, amount1;
  if (t0.address.toLowerCase() < t1.address.toLowerCase()) {
    token0 = t0; token1 = t1;
    amount0 = ethers.parseUnits(args.amount0, t0.decimals);
    amount1 = ethers.parseUnits(args.amount1, t1.decimals);
  } else {
    token0 = t1; token1 = t0;
    amount0 = ethers.parseUnits(args.amount1, t1.decimals);
    amount1 = ethers.parseUnits(args.amount0, t0.decimals);
  }
  
  const signer = await getSigner();
  const myAddress = await signer.getAddress();
  const provider = signer.provider;
  
  const factory = new ethers.Contract(CONTRACTS.Factory, FACTORY_ABI, provider);
  const poolAddr = await factory.getPool(token0.address, token1.address, fee);
  if (poolAddr === ethers.ZeroAddress) throw new Error(`Pool does not exist for this pair at ${feeToPercent(fee)} fee`);
  
  const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
  const [slot0, tickSpacing] = await Promise.all([pool.slot0(), pool.tickSpacing()]);
  const currentTick = Number(slot0.tick);
  const spacing = Number(tickSpacing);
  
  let tickLower, tickUpper;
  if (args.tickLower && args.tickUpper) {
    tickLower = parseInt(args.tickLower);
    tickUpper = parseInt(args.tickUpper);
  } else {
    const rangePct = parseFloat(args.range || '10');
    const tickRange = Math.ceil(Math.log(1 + rangePct / 100) / Math.log(1.0001));
    tickLower = Math.floor((currentTick - tickRange) / spacing) * spacing;
    tickUpper = Math.ceil((currentTick + tickRange) / spacing) * spacing;
  }
  
  tickLower = Math.floor(tickLower / spacing) * spacing;
  tickUpper = Math.ceil(tickUpper / spacing) * spacing;
  if (tickLower >= tickUpper) throw new Error('tickLower must be < tickUpper');
  
  console.log(`\nMinting Enosys V3 position: ${token0.symbol}/${token1.symbol}`);
  console.log(`  Fee: ${feeToPercent(fee)}, Current tick: ${currentTick}, Range: [${tickLower}, ${tickUpper}]`);
  
  // Approve
  const nfpmAddr = CONTRACTS.NonfungiblePositionManager;
  for (const [token, amt] of [[token0, amount0], [token1, amount1]]) {
    const erc20 = new ethers.Contract(token.address, ERC20_ABI, signer);
    const allowance = await erc20.allowance(myAddress, nfpmAddr);
    if (allowance < amt) {
      console.log(`  Approving ${token.symbol}...`);
      await (await erc20.approve(nfpmAddr, ethers.MaxUint256)).wait();
    }
  }
  
  const nfpm = new ethers.Contract(nfpmAddr, NFPM_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  
  console.log('  Sending mint transaction...');
  const tx = await nfpm.mint({
    token0: token0.address,
    token1: token1.address,
    fee,
    tickLower,
    tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: myAddress,
    deadline,
  });
  
  console.log(`  Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const transferLog = receipt.logs.find(l => l.topics[0] === transferTopic && l.address.toLowerCase() === nfpmAddr.toLowerCase());
  const tokenId = transferLog ? BigInt(transferLog.topics[3]).toString() : 'unknown';
  
  console.log(`  ✓ Minted position #${tokenId} in block ${receipt.blockNumber}\n`);
}

async function cmdAdd(args) {
  if (!args.tokenId || (!args.amount0 && !args.amount1)) {
    console.log('Usage: node lp.js add --tokenId 123 --amount0 100 --amount1 10');
    process.exit(1);
  }
  
  const signer = await getSigner();
  const myAddress = await signer.getAddress();
  const nfpm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NFPM_ABI, signer);
  
  const pos = await nfpm.positions(args.tokenId);
  const dec0 = tokenDecimals(pos.token0);
  const dec1 = tokenDecimals(pos.token1);
  
  const amount0 = args.amount0 ? ethers.parseUnits(args.amount0, dec0) : 0n;
  const amount1 = args.amount1 ? ethers.parseUnits(args.amount1, dec1) : 0n;
  
  for (const [addr, amt] of [[pos.token0, amount0], [pos.token1, amount1]]) {
    if (amt > 0n) {
      const erc20 = new ethers.Contract(addr, ERC20_ABI, signer);
      const allowance = await erc20.allowance(myAddress, CONTRACTS.NonfungiblePositionManager);
      if (allowance < amt) {
        await (await erc20.approve(CONTRACTS.NonfungiblePositionManager, ethers.MaxUint256)).wait();
      }
    }
  }
  
  console.log(`\nAdding liquidity to position #${args.tokenId}...`);
  const tx = await nfpm.increaseLiquidity({
    tokenId: BigInt(args.tokenId),
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 0n,
    amount1Min: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  });
  
  const receipt = await tx.wait();
  console.log(`  ✓ Liquidity added in block ${receipt.blockNumber}\n`);
}

async function cmdRemove(args) {
  if (!args.tokenId) {
    console.log('Usage: node lp.js remove --tokenId 123 --percent 100');
    process.exit(1);
  }
  
  const percent = parseFloat(args.percent || '100');
  const signer = await getSigner();
  const myAddress = await signer.getAddress();
  const nfpm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NFPM_ABI, signer);
  
  const pos = await nfpm.positions(args.tokenId);
  if (pos.liquidity === 0n) { console.log('Position has no liquidity'); return; }
  
  const liquidityToRemove = pos.liquidity * BigInt(Math.floor(percent * 100)) / 10000n;
  
  console.log(`\nRemoving ${percent}% liquidity from position #${args.tokenId}...`);
  
  const tx1 = await nfpm.decreaseLiquidity({
    tokenId: BigInt(args.tokenId),
    liquidity: liquidityToRemove,
    amount0Min: 0n,
    amount1Min: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
  });
  await tx1.wait();
  console.log('  ✓ Liquidity decreased');
  
  const MAX_UINT128 = (1n << 128n) - 1n;
  const tx2 = await nfpm.collect({
    tokenId: BigInt(args.tokenId),
    recipient: myAddress,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  const receipt = await tx2.wait();
  
  const sym0 = tokenSymbol(pos.token0);
  const sym1 = tokenSymbol(pos.token1);
  console.log(`  ✓ Collected ${sym0} + ${sym1} in block ${receipt.blockNumber}`);
  
  if (percent >= 100) {
    try {
      await (await nfpm.burn(BigInt(args.tokenId))).wait();
      console.log('  ✓ Position burned');
    } catch (e) {
      console.log('  ⚠ Could not burn (may have remaining tokens)');
    }
  }
  console.log();
}

async function cmdCollect(args) {
  if (!args.tokenId) {
    console.log('Usage: node lp.js collect --tokenId 123');
    process.exit(1);
  }
  
  const signer = await getSigner();
  const myAddress = await signer.getAddress();
  const nfpm = new ethers.Contract(CONTRACTS.NonfungiblePositionManager, NFPM_ABI, signer);
  
  const pos = await nfpm.positions(args.tokenId);
  const sym0 = tokenSymbol(pos.token0);
  const sym1 = tokenSymbol(pos.token1);
  
  console.log(`\nCollecting fees from position #${args.tokenId} (${sym0}/${sym1})...`);
  
  const MAX_UINT128 = (1n << 128n) - 1n;
  const tx = await nfpm.collect({
    tokenId: BigInt(args.tokenId),
    recipient: myAddress,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  
  console.log(`  Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✓ Fees collected in block ${receipt.blockNumber}\n`);
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
      case 'positions': await cmdPositions(args); break;
      case 'check':     await cmdCheck(args); break;
      case 'mint':      await cmdMint(args); break;
      case 'add':       await cmdAdd(args); break;
      case 'remove':    await cmdRemove(args); break;
      case 'collect':   await cmdCollect(args); break;
      default:
        console.log('Enosys V3 LP Manager — Uniswap V3 on Flare\n');
        console.log('Commands:');
        console.log('  positions --address 0x...');
        console.log('  check     --address 0x...');
        console.log('  mint      --token0 WFLR --token1 FXRP --amount0 1000 --amount1 100 [--fee 3000] [--range 10]');
        console.log('  add       --tokenId 123 --amount0 100 --amount1 10');
        console.log('  remove    --tokenId 123 [--percent 100]');
        console.log('  collect   --tokenId 123');
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
