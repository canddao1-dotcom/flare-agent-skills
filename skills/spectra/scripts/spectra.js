#!/usr/bin/env node
/**
 * Spectra Finance Skill
 * 
 * Yield trading on Flare - PT/YT tokens for stXRP and sFLR
 */

const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';
const DEFAULT_KEYSTORE = process.env.AGENT_KEYSTORE || './keystore.json';

// Pool Configurations
const POOLS = {
  stxrp: {
    name: 'stXRP (Mar 05, 2026)',
    pool: '0xa65a736bcf1f4af7a8f353027218f2d54b3048eb',
    pt: '0x097Dd93Bf92bf9018fF194195dDfCFB2c359335e',
    yt: '0x46f0C7b81128e031604eCb3e8A7E28dd3F8A50C9',
    ibt: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3',
    underlying: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
    decimals: 6,
    ibtSymbol: 'stXRP',
    maturity: '2026-03-05',
  },
  sflr: {
    name: 'sFLR (May 17, 2026)',
    pool: '0x5d31ef52e2571294c91f01a3d12bf664d2951666',
    pt: '0x14613BFc52F98af194F4e0b1D23fE538B54628f3',
    yt: null, // Need to find
    ibt: '0xB9003d5bEd06afD570139d21c64817298DD47eC1',
    underlying: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
    decimals: 18,
    ibtSymbol: 'sw-sFLR',
    maturity: '2026-05-17',
  },
};

// ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const PT_ABI = [
  ...ERC20_ABI,
  'function maturity() view returns (uint256)',
  'function getIBT() view returns (address)',
  'function getYT() view returns (address)',
  'function underlying() view returns (address)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewDepositIBT(uint256 ibts) view returns (uint256)',
  'function depositIBT(uint256 ibts, address ptReceiver, address ytReceiver) returns (uint256)',
  'function depositIBT(uint256 ibts, address ptReceiver, address ytReceiver, uint256 minShares) returns (uint256)',
  'function redeemForIBT(uint256 shares, address receiver, address owner) returns (uint256)',
  'function totalAssets() view returns (uint256)',
];

const CURVE_POOL_ABI = [
  ...ERC20_ABI,
  'function coins(uint256) view returns (address)',
  'function balances(uint256) view returns (uint256)',
  'function get_virtual_price() view returns (uint256)',
  'function fee() view returns (uint256)',
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)',
  'function add_liquidity(uint256[2] amounts, uint256 min_mint_amount) returns (uint256)',
  'function remove_liquidity(uint256 _amount, uint256[2] min_amounts) returns (uint256[2])',
  'function remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 _min_amount) returns (uint256)',
  'function calc_withdraw_one_coin(uint256 _token_amount, int128 i) view returns (uint256)',
  'function calc_token_amount(uint256[2] amounts, bool is_deposit) view returns (uint256)',
];

async function getProvider() {
  return new ethers.JsonRpcProvider(FLARE_RPC);
}

async function getSigner(keystorePath) {
  const provider = await getProvider();
  const walletData = JSON.parse(fs.readFileSync(keystorePath || DEFAULT_KEYSTORE));
  return new ethers.Wallet(walletData.privateKey, provider);
}

// ============ STATUS ============
async function status() {
  const provider = await getProvider();
  
  console.log('📊 SPECTRA POOLS STATUS\n');
  
  for (const [key, config] of Object.entries(POOLS)) {
    console.log(`=== ${config.name} ===`);
    console.log(`Pool: ${config.pool}`);
    console.log(`Maturity: ${config.maturity}`);
    
    const pool = new ethers.Contract(config.pool, CURVE_POOL_ABI, provider);
    const pt = new ethers.Contract(config.pt, PT_ABI, provider);
    
    try {
      const [bal0, bal1, vp, totalPT] = await Promise.all([
        pool.balances(0),
        pool.balances(1),
        pool.get_virtual_price(),
        pt.totalSupply(),
      ]);
      
      const ibtBal = Number(ethers.formatUnits(bal0, config.decimals));
      const ptBal = Number(ethers.formatUnits(bal1, config.decimals));
      const totalLiq = ibtBal + ptBal;
      
      console.log(`IBT (${config.ibtSymbol}): ${ibtBal.toLocaleString()} (${(ibtBal/totalLiq*100).toFixed(1)}%)`);
      console.log(`PT: ${ptBal.toLocaleString()} (${(ptBal/totalLiq*100).toFixed(1)}%)`);
      console.log(`Virtual Price: ${ethers.formatUnits(vp, 18)}`);
      console.log(`Total PT Supply: ${Number(ethers.formatUnits(totalPT, config.decimals)).toLocaleString()}`);
      
      // Get swap rate
      try {
        const testAmt = ethers.parseUnits('1', config.decimals);
        const dy = await pool.get_dy(1, 0, testAmt); // PT -> IBT
        console.log(`1 PT → ${ethers.formatUnits(dy, config.decimals)} ${config.ibtSymbol}`);
      } catch(e) {}
      
    } catch(e) {
      console.log('Error fetching pool data:', e.message.slice(0, 50));
    }
    
    console.log('');
  }
}

// ============ BALANCE ============
async function balance(address) {
  const provider = await getProvider();
  
  if (!address) {
    const walletData = JSON.parse(fs.readFileSync(DEFAULT_KEYSTORE));
    const wallet = new ethers.Wallet(walletData.privateKey);
    address = wallet.address;
  }
  
  console.log(`📊 SPECTRA BALANCE: ${address.slice(0,10)}...\n`);
  
  for (const [key, config] of Object.entries(POOLS)) {
    console.log(`=== ${config.name} ===`);
    
    const pool = new ethers.Contract(config.pool, ERC20_ABI, provider);
    const pt = new ethers.Contract(config.pt, ERC20_ABI, provider);
    const ibt = new ethers.Contract(config.ibt, ERC20_ABI, provider);
    
    const [lpBal, ptBal, ibtBal] = await Promise.all([
      pool.balanceOf(address),
      pt.balanceOf(address),
      ibt.balanceOf(address),
    ]);
    
    console.log(`LP: ${ethers.formatUnits(lpBal, 18)}`);
    console.log(`PT: ${ethers.formatUnits(ptBal, config.decimals)}`);
    console.log(`IBT (${config.ibtSymbol}): ${ethers.formatUnits(ibtBal, config.decimals)}`);
    
    if (config.yt) {
      const yt = new ethers.Contract(config.yt, ERC20_ABI, provider);
      const ytBal = await yt.balanceOf(address);
      console.log(`YT: ${ethers.formatUnits(ytBal, config.decimals)}`);
    }
    
    console.log('');
  }
}

// ============ POOLS ============
async function pools() {
  console.log('📊 SPECTRA POOLS ON FLARE\n');
  
  for (const [key, config] of Object.entries(POOLS)) {
    console.log(`=== ${config.name} ===`);
    console.log(`Key: ${key}`);
    console.log(`Pool: ${config.pool}`);
    console.log(`PT: ${config.pt}`);
    console.log(`YT: ${config.yt || 'N/A'}`);
    console.log(`IBT: ${config.ibt}`);
    console.log(`Underlying: ${config.underlying}`);
    console.log(`Maturity: ${config.maturity}`);
    console.log('');
  }
}

// ============ DEPOSIT (IBT -> PT + YT) ============
async function deposit(amount, poolKey, keystorePath) {
  poolKey = poolKey.toLowerCase();
  const config = POOLS[poolKey];
  
  if (!config) {
    console.error('❌ Invalid pool. Use: stxrp or sflr');
    process.exit(1);
  }
  
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  
  const ibt = new ethers.Contract(config.ibt, ERC20_ABI, signer);
  const pt = new ethers.Contract(config.pt, PT_ABI, signer);
  
  const amountWei = ethers.parseUnits(amount.toString(), config.decimals);
  
  // Check balance
  const ibtBalance = await ibt.balanceOf(address);
  if (ibtBalance < amountWei) {
    console.error(`❌ Insufficient ${config.ibtSymbol}. Have: ${ethers.formatUnits(ibtBalance, config.decimals)}, Need: ${amount}`);
    process.exit(1);
  }
  
  // Preview
  const ptOut = await pt.previewDepositIBT(amountWei);
  
  console.log(`📥 SPECTRA DEPOSIT: ${config.name}`);
  console.log(`   Input: ${amount} ${config.ibtSymbol}`);
  console.log(`   Expected PT: ${ethers.formatUnits(ptOut, config.decimals)}`);
  console.log(`   Expected YT: ${ethers.formatUnits(ptOut, config.decimals)}`);
  console.log('');
  
  // Approve if needed
  const allowance = await ibt.allowance(address, config.pt);
  if (allowance < amountWei) {
    console.log('📝 Approving IBT...');
    const approveTx = await ibt.approve(config.pt, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Execute deposit
  console.log('🔄 Depositing...');
  try {
    const tx = await pt['depositIBT(uint256,address,address)'](amountWei, address, address);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas: ${receipt.gasUsed.toString()}`);
    
    console.log('');
    console.log('✅ Deposit Complete!');
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Deposit failed:', err.message);
    if (err.data) console.error('   Data:', err.data);
    process.exit(1);
  }
}

// ============ SWAP ============
async function swap(from, to, amount, poolKey, keystorePath) {
  poolKey = poolKey || 'stxrp';
  const config = POOLS[poolKey.toLowerCase()];
  
  if (!config) {
    console.error('❌ Invalid pool. Use: stxrp or sflr');
    process.exit(1);
  }
  
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  
  const pool = new ethers.Contract(config.pool, CURVE_POOL_ABI, signer);
  
  // Determine direction: coin[0] = IBT, coin[1] = PT
  let i, j, tokenIn, tokenInAddr;
  from = from.toLowerCase();
  
  if (from === 'pt') {
    i = 1; j = 0;
    tokenIn = 'PT';
    tokenInAddr = config.pt;
  } else if (from === 'ibt' || from === config.ibtSymbol.toLowerCase()) {
    i = 0; j = 1;
    tokenIn = config.ibtSymbol;
    tokenInAddr = config.ibt;
  } else {
    console.error('❌ Invalid from token. Use: pt or ibt/' + config.ibtSymbol.toLowerCase());
    process.exit(1);
  }
  
  const amountWei = ethers.parseUnits(amount.toString(), config.decimals);
  
  // Check balance
  const token = new ethers.Contract(tokenInAddr, ERC20_ABI, signer);
  const tokenBalance = await token.balanceOf(address);
  if (tokenBalance < amountWei) {
    console.error(`❌ Insufficient ${tokenIn}. Have: ${ethers.formatUnits(tokenBalance, config.decimals)}, Need: ${amount}`);
    process.exit(1);
  }
  
  // Get quote
  const dyOut = await pool.get_dy(i, j, amountWei);
  const minOut = dyOut * 99n / 100n; // 1% slippage
  
  console.log(`🔄 SPECTRA SWAP: ${config.name}`);
  console.log(`   ${amount} ${tokenIn} → ~${ethers.formatUnits(dyOut, config.decimals)} ${i === 0 ? 'PT' : config.ibtSymbol}`);
  console.log(`   Min output (1% slip): ${ethers.formatUnits(minOut, config.decimals)}`);
  console.log('');
  
  // Approve if needed
  const allowance = await token.allowance(address, config.pool);
  if (allowance < amountWei) {
    console.log('📝 Approving...');
    const approveTx = await token.approve(config.pool, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Execute swap
  console.log('🔄 Swapping...');
  try {
    const tx = await pool.exchange(i, j, amountWei, minOut);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log('');
    console.log('✅ Swap Complete!');
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Swap failed:', err.message);
    process.exit(1);
  }
}

// ============ ADD LIQUIDITY ============
async function lpAdd(amount, poolKey, keystorePath) {
  poolKey = poolKey || 'stxrp';
  const config = POOLS[poolKey.toLowerCase()];
  
  if (!config) {
    console.error('❌ Invalid pool');
    process.exit(1);
  }
  
  const signer = await getSigner(keystorePath);
  const address = await signer.getAddress();
  
  const pool = new ethers.Contract(config.pool, CURVE_POOL_ABI, signer);
  const ibt = new ethers.Contract(config.ibt, ERC20_ABI, signer);
  
  const amountWei = ethers.parseUnits(amount.toString(), config.decimals);
  
  // Check balance
  const ibtBalance = await ibt.balanceOf(address);
  if (ibtBalance < amountWei) {
    console.error(`❌ Insufficient ${config.ibtSymbol}. Have: ${ethers.formatUnits(ibtBalance, config.decimals)}`);
    process.exit(1);
  }
  
  // Preview LP tokens
  const lpOut = await pool.calc_token_amount([amountWei, 0n], true);
  
  console.log(`📥 ADD LIQUIDITY: ${config.name}`);
  console.log(`   Input: ${amount} ${config.ibtSymbol}`);
  console.log(`   Expected LP: ~${ethers.formatUnits(lpOut, 18)}`);
  console.log('');
  
  // Approve
  const allowance = await ibt.allowance(address, config.pool);
  if (allowance < amountWei) {
    console.log('📝 Approving...');
    const approveTx = await ibt.approve(config.pool, ethers.MaxUint256);
    await approveTx.wait();
    console.log('   Approved ✓');
  }
  
  // Add liquidity (single-sided IBT)
  console.log('🔄 Adding liquidity...');
  try {
    const minLp = lpOut * 99n / 100n;
    const tx = await pool.add_liquidity([amountWei, 0n], minLp);
    console.log(`   Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log('');
    console.log('✅ Liquidity Added!');
    console.log(`   Tx: https://flarescan.com/tx/${receipt.hash}`);
    
  } catch (err) {
    console.error('❌ Add liquidity failed:', err.message);
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
  
  const keystorePath = getArg('keystore') || DEFAULT_KEYSTORE;
  const poolKey = getArg('pool') || 'stxrp';
  
  if (!command || command === '--help') {
    console.log(`
Spectra Finance CLI

Usage: node spectra.js <command> [options]

Commands:
  status              Pool stats, APY, TVL
  balance [address]   Check PT/YT/LP balances
  pools               List all pools
  deposit <amt>       Deposit IBT → PT + YT
  swap <from> <to> <amt>  Swap PT ↔ IBT
  lp add <amt>        Add single-sided liquidity

Options:
  --pool <key>        Pool to use: stxrp, sflr (default: stxrp)
  --keystore <path>   Wallet keystore

Examples:
  node spectra.js status
  node spectra.js deposit 10 --pool stxrp
  node spectra.js swap pt ibt 5 --pool stxrp
  node spectra.js lp add 10 --pool stxrp
`);
    return;
  }
  
  switch (command) {
    case 'status':
      await status();
      break;
      
    case 'balance':
      await balance(args[1]);
      break;
      
    case 'pools':
      await pools();
      break;
      
    case 'deposit':
      if (!args[1]) {
        console.error('Usage: deposit <amount>');
        process.exit(1);
      }
      await deposit(args[1], poolKey, keystorePath);
      break;
      
    case 'swap':
      if (!args[1] || !args[2] || !args[3]) {
        console.error('Usage: swap <from> <to> <amount>');
        process.exit(1);
      }
      await swap(args[1], args[2], args[3], poolKey, keystorePath);
      break;
      
    case 'lp':
      if (args[1] === 'add' && args[2]) {
        await lpAdd(args[2], poolKey, keystorePath);
      } else {
        console.error('Usage: lp add <amount>');
        process.exit(1);
      }
      break;
      
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(console.error);
