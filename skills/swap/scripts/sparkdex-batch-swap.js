#!/usr/bin/env node
/**
 * SparkDex Batch Swap - Test multiple pools
 * Usage: node sparkdex-batch-swap.js <batch_number>
 * Batch 1: pools 0-11, Batch 2: pools 12-23, Batch 3: pools 24-33
 */

const { ethers } = require('ethers');
const fs = require('fs');

const RPC = 'https://flare-api.flare.network/ext/C/rpc';
const ROUTER = '0x8a1E35F5c98C4E85B36B7B253222eE17773b2781';
const WFLR = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';

const TOKENS = {
  '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d': { symbol: 'WFLR', decimals: 18 },
  '0x12e605bc104e93B45e1aD99F9e555f659051c2BB': { symbol: 'sFLR', decimals: 18 },
  '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE': { symbol: 'FXRP', decimals: 6 },
  '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3': { symbol: 'stXRP', decimals: 6 },
  '0xe7cd86e13AC4309349F30B3435a9d337750fC82D': { symbol: 'USDT0', decimals: 6 },
  '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6': { symbol: 'USDC', decimals: 6 },
};

// All 34 pools
const ALL_POOLS = [
  { pool: '0x9A3215f8B0d128816F75175c9fD74e7ebbD987DA', token0: WFLR, token1: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', fee: 500 },
  { pool: '0x9b35c9185659C0536dc0d8c674cE722b7d3859Ba', token0: WFLR, token1: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', fee: 10000 },
  { pool: '0xD75D57A09E42E6aA336c274D08164B04aA7E7dDb', token0: WFLR, token1: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', fee: 3000 },
  { pool: '0x3Bc1eCbcd645e525508c570A0fF04480a5614a86', token0: WFLR, token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 500 },
  { pool: '0x63873f0d7165689022FeEf1B77428DF357b33dcf', token0: WFLR, token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 500 },
  { pool: '0x589689984a06E4640593eDec64e415c415940C7F', token0: WFLR, token1: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', fee: 500 },
  { pool: '0x8ee8414eE2B9D4Bf6c8DE40d95167C2643C2C544', token0: WFLR, token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 500 },
  { pool: '0x39D3AAa76D153518CB10bfD5DF92c65D8573a0b5', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', fee: 3000 },
  { pool: '0xDAD1976C48cf93A7D90f106382C60Cd2c888b2dc', token0: WFLR, token1: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', fee: 3000 },
  { pool: '0x08E6cB0c6b91dba21B9b5DFF5694faB75fA91440', token0: WFLR, token1: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', fee: 10000 },
  { pool: '0x2860DB7a2B33B79e59Ea450Ff43B2dC673A22D3d', token0: WFLR, token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 3000 },
  { pool: '0x2fD9Ca7353788DfbbeA36292252533809A8e9da3', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', fee: 10000 },
  { pool: '0x87B8135DeFE130Cb3Edf78a578a230D4d5F19bad', token0: WFLR, token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 10000 },
  { pool: '0xD5638D302378Fc414CbB4fbCe97c2061BaA32657', token0: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 10000 },
  { pool: '0x0272e53d5a76D9e10B17dbe66ef12250816706C7', token0: WFLR, token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 3000 },
  { pool: '0xEB60231fdB15f37F8dCfFD351B3C776A556e7736', token0: WFLR, token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 3000 },
  { pool: '0x809AC9CCf86CCc1793CE2229b87D9c11242bB3b0', token0: WFLR, token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 10000 },
  { pool: '0xb80f6188de9670649DbcB45FDEea82E713138A34', token0: WFLR, token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 10000 },
  { pool: '0xd7428eb2052D736B3384524eff732d0BA2051793', token0: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 500 },
  { pool: '0xffEd33D28ca65e52e927849F456D8e820B324508', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 500 },
  { pool: '0x07FC2A6170a2070a133f63eC226768761559994a', token0: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 3000 },
  { pool: '0x38e386c7237140CA809a36162A652748fEC51492', token0: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 10000 },
  { pool: '0x88D46717b16619B37fa2DfD2F038DEFB4459F1F7', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 500 },
  { pool: '0x68E9c7E90C159cFF4f7c257D7c0B3FB1Fa1f8Ef5', token0: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 500 },
  { pool: '0xb3fFF9a416f549534af0C6d52f13155450117fe3', token0: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 500 },
  { pool: '0xe6a19F2af519cad120253Ff6372f5f76c5658Ec2', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 10000 },
  { pool: '0x7FFed91010b3c5813e019336F1C772F20d4D0b51', token0: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 10000 },
  { pool: '0xb0501E64fa11d810d47666012e24c5d55799ef7D', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', fee: 3000 },
  { pool: '0x38dE858370813ae58af11245962a9b03B661a9Ae', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 10000 },
  { pool: '0xC706C8FeC94D0c44E636fD0333EB57377f07f662', token0: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 3000 },
  { pool: '0xd0B506208974Ca6088a65B613216E07F7c65263b', token0: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 500 },
  { pool: '0x8F7E2dCbbb1A1BCacE7832e4770ec31D8C6937cB', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', fee: 3000 },
  { pool: '0xD84A2A9Cd6B850FB802dc12c6434dB67da015f53', token0: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', token1: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', fee: 10000 },
  { pool: '0x9C0d44D2F6e60a4995153c2d848C113a3bdE56e7', token0: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', token1: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', fee: 500 },
];

async function main() {
  const batch = parseInt(process.argv[2]) || 1;
  const start = (batch - 1) * 12;
  const end = Math.min(start + 12, ALL_POOLS.length);
  const pools = ALL_POOLS.slice(start, end);
  
  console.log(`\n🔷 SparkDex Batch ${batch}: Testing pools ${start}-${end-1} (${pools.length} pools)\n`);
  
  const provider = new ethers.JsonRpcProvider(RPC);
  const walletData = JSON.parse(fs.readFileSync(process.env.AGENT_KEYSTORE || './keystore.json'));
  const wallet = new ethers.Wallet(walletData.privateKey, provider);
  
  const routerAbi = ['function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) payable returns (uint256)'];
  const router = new ethers.Contract(ROUTER, routerAbi, wallet);
  const erc20Abi = ['function approve(address,uint256)', 'function allowance(address,address) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];
  
  const results = [];
  
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    const idx = start + i;
    const t0 = TOKENS[p.token0] || { symbol: p.token0.slice(0,8), decimals: 18 };
    const t1 = TOKENS[p.token1] || { symbol: p.token1.slice(0,8), decimals: 18 };
    
    // Always swap from token0 to token1 with 1 unit worth
    const tokenIn = p.token0;
    const tokenOut = p.token1;
    const decIn = t0.decimals;
    
    // Use 1 WFLR equivalent
    const amountIn = tokenIn === WFLR ? ethers.parseUnits('1', 18) : ethers.parseUnits('0.01', decIn);
    
    console.log(`[${idx}] ${t0.symbol}→${t1.symbol} (${p.fee/10000}%) ${p.pool.slice(0,10)}...`);
    
    const token = new ethers.Contract(tokenIn, erc20Abi, wallet);
    
    // Check balance
    const bal = await token.balanceOf(wallet.address);
    if (bal < amountIn) {
      console.log(`   ⏭️  Skip - insufficient ${t0.symbol}`);
      results.push({ idx, pair: `${t0.symbol}/${t1.symbol}`, status: 'SKIP', reason: 'balance' });
      continue;
    }
    
    // Approve if needed
    const allowance = await token.allowance(wallet.address, ROUTER);
    if (allowance < amountIn) {
      const appTx = await token.approve(ROUTER, ethers.MaxUint256);
      await appTx.wait();
    }
    
    // Swap
    const deadline = Math.floor(Date.now() / 1000) + 600;
    try {
      const tx = await router.exactInputSingle([
        tokenIn, tokenOut, p.fee, wallet.address, deadline, amountIn, 0n, 0n
      ]);
      const receipt = await tx.wait();
      console.log(`   ✅ ${tx.hash.slice(0,10)}... gas:${receipt.gasUsed}`);
      results.push({ idx, pair: `${t0.symbol}/${t1.symbol}`, status: 'OK', tx: tx.hash, gas: receipt.gasUsed.toString() });
    } catch (e) {
      console.log(`   ❌ ${e.message.slice(0,50)}`);
      results.push({ idx, pair: `${t0.symbol}/${t1.symbol}`, status: 'FAIL', error: e.message.slice(0,50) });
    }
  }
  
  console.log(`\n📊 Batch ${batch} Summary:`);
  const ok = results.filter(r => r.status === 'OK').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const skip = results.filter(r => r.status === 'SKIP').length;
  console.log(`   ✅ ${ok} OK | ❌ ${fail} FAIL | ⏭️  ${skip} SKIP`);
  
  // Output JSON for collection
  console.log('\n' + JSON.stringify(results));
}

main().catch(e => console.error('Fatal:', e.message));
