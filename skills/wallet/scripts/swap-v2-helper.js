#!/usr/bin/env node
/**
 * V2 Swap Helper - Deploys a minimal contract for atomic swaps
 * 
 * Since V2 pairs require transfer+swap in same tx, we need a helper.
 */

const { ethers } = require('ethers');
const fs = require('fs');

const FLARE_RPC = 'https://flare-api.flare.network/ext/C/rpc';

// Minimal V2 Swap Helper bytecode
// This contract: receives tokens, swaps on pair, sends output to caller
const SWAP_HELPER_BYTECODE = `
608060405234801561001057600080fd5b50610567806100206000396000f3fe
608060405234801561001057600080fd5b506004361061002b5760003560e01c
8063c04062261461003057600080fd5b600080fd5b61004a6004803603810190
610045919061034c565b61004c565b005b600084905060008173ffffffffffffffff
ffffffffffffffffffffffff166370a08231306040518263ffffffff1660e01b815260
040161008c91906103cb565b602060405180830381865afa1580156100a957
3d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052
5081019061012d91906103fb565b9050600061015b8261014d87896fffffffff
ffffffffffffffffffffffff1661023e565b610254919061046d565b905060008773
ffffffffffffffffffffffffffffffffffffffff1663022c0d9f88600085336040518563
ffffffff1660e01b8152600401610199949392919061049e565b600060405180830381
600087803b1580156101b357600080fd5b505af11580156101c7573d6000803e3d6000
fd5b505050508573ffffffffffffffffffffffffffffffffffffffff1663a9059cbb33
836040518363ffffffff1660e01b815260040161020592919061050e565b6020604051
80830381865afa158015610222573d6000803e3d6000fd5b50505050505050505050
5050565b600081836102489190610537565b905092915050565b60008183610260919061
0568565b905092915050565b600080fd5b600073ffffffffffffffffffffffffffff
ffffffffffff82169050919050565b600061029a8261026f565b9050919050565b6102aa
8161028f565b81146102b557600080fd5b50565b6000813590506102c7816102a1565b
92915050565b60006fffffffffffffffffffffffffffffffff82169050919050565b6102f1816102cd565b81146102fc57600080fd5b50565b60008135905061030e816102e8565b92915050565b6000819050919050565b61032781610314565b811461033257600080fd5b50565b6000813590506103448161031e565b92915050565b60008060008060808587031215610364576103636102685765b6103716102b8565b935061037f602086016102b8565b925061038d604086016102ff565b91506103c1606086016102b8565b90509295919450925050565b60006020820190506103e26000830184610389565b92915050565b6000815190506103f781610314565b92915050565b6000602082840312156104135761041261026856565b6104208484610e85b5050919050565b610428610314565b905091905056
`.replace(/\s/g, '');

// Simpler approach: Use pair's swap directly with transferFrom
// The pair accepts tokens via transferFrom if approved

const PAIR_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function swap(uint amount0Out, uint amount1Out, address to, bytes data)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// Known pairs
const PAIRS = {
  'BANK/WFLR': {
    address: '0x5f29c8d049e47dd180c2b83e3560e8e271110335',
    token0: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', // BANK
    token1: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', // WFLR
  }
};

/**
 * Calculate V2 swap output
 */
function getAmountOut(amountIn, reserveIn, reserveOut) {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

/**
 * Execute V2 swap by sending tokens first, then calling swap
 * This works because the pair checks balances, not transferFrom
 */
async function executeV2Swap(signer, pairAddress, tokenIn, tokenOut, amountIn, minAmountOut) {
  const provider = signer.provider;
  const walletAddress = await signer.getAddress();
  
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, signer);
  
  // Get reserves and token order
  const [reserves, token0] = await Promise.all([
    pair.getReserves(),
    pair.token0()
  ]);
  
  const isToken0In = tokenIn.toLowerCase() === token0.toLowerCase();
  const reserveIn = isToken0In ? reserves[0] : reserves[1];
  const reserveOut = isToken0In ? reserves[1] : reserves[0];
  
  // Calculate expected output
  const amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
  
  if (amountOut < minAmountOut) {
    throw new Error(`Insufficient output: ${amountOut} < ${minAmountOut}`);
  }
  
  console.log('Expected output:', ethers.formatEther(amountOut));
  
  // Step 1: Transfer tokens directly to pair
  console.log('Transferring tokens to pair...');
  const transferTx = await tokenContract.transfer(pairAddress, amountIn);
  await transferTx.wait();
  console.log('Transfer confirmed');
  
  // Step 2: Call swap
  const amount0Out = isToken0In ? 0n : amountOut;
  const amount1Out = isToken0In ? amountOut : 0n;
  
  console.log('Calling swap...');
  const pairWithSigner = new ethers.Contract(pairAddress, PAIR_ABI, signer);
  const swapTx = await pairWithSigner.swap(amount0Out, amount1Out, walletAddress, '0x');
  const receipt = await swapTx.wait();
  
  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    amountOut: amountOut
  };
}

/**
 * Get quote for V2 swap
 */
async function getQuoteV2(provider, pairAddress, tokenIn, amountIn) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  
  const [reserves, token0] = await Promise.all([
    pair.getReserves(),
    pair.token0()
  ]);
  
  const isToken0In = tokenIn.toLowerCase() === token0.toLowerCase();
  const reserveIn = isToken0In ? reserves[0] : reserves[1];
  const reserveOut = isToken0In ? reserves[1] : reserves[0];
  
  return getAmountOut(amountIn, reserveIn, reserveOut);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.length < 1) {
    console.log(`
V2 Swap Helper for BANK/WFLR

Usage:
  node swap-v2-helper.js quote --from WFLR --amount 10
  node swap-v2-helper.js swap --keystore <path> --from WFLR --amount 10 --slippage 2

Options:
  --from        Input token (WFLR or BANK)
  --amount      Amount to swap
  --slippage    Slippage % (default: 1)
  --keystore    Wallet JSON path
`);
    return;
  }
  
  const command = args[0];
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };
  
  const provider = new ethers.JsonRpcProvider(FLARE_RPC);
  const pairInfo = PAIRS['BANK/WFLR'];
  
  const fromToken = getArg('from')?.toUpperCase();
  const amount = getArg('amount');
  const slippage = parseFloat(getArg('slippage') || '1') / 100;
  const keystorePath = getArg('keystore');
  
  if (!fromToken || !amount) {
    console.error('Missing --from or --amount');
    process.exit(1);
  }
  
  const tokenIn = fromToken === 'WFLR' ? pairInfo.token1 : pairInfo.token0;
  const tokenOut = fromToken === 'WFLR' ? pairInfo.token0 : pairInfo.token1;
  const tokenOutSymbol = fromToken === 'WFLR' ? 'BANK' : 'WFLR';
  const amountIn = ethers.parseEther(amount);
  
  if (command === 'quote') {
    const amountOut = await getQuoteV2(provider, pairInfo.address, tokenIn, amountIn);
    console.log(`\n📊 V2 Quote (BANK/WFLR Enosys)`);
    console.log(`   ${amount} ${fromToken} → ${ethers.formatEther(amountOut)} ${tokenOutSymbol}`);
    console.log(`   Rate: 1 ${fromToken} = ${(Number(amountOut) / Number(amountIn)).toFixed(6)} ${tokenOutSymbol}`);
    
  } else if (command === 'swap') {
    if (!keystorePath) {
      console.error('Missing --keystore');
      process.exit(1);
    }
    
    const walletData = JSON.parse(fs.readFileSync(keystorePath));
    const signer = new ethers.Wallet(walletData.privateKey, provider);
    
    // Get quote first
    const expectedOut = await getQuoteV2(provider, pairInfo.address, tokenIn, amountIn);
    const minAmountOut = expectedOut * BigInt(Math.floor((1 - slippage) * 10000)) / 10000n;
    
    console.log(`\n📊 V2 Swap (BANK/WFLR Enosys)`);
    console.log(`   ${amount} ${fromToken} → ~${ethers.formatEther(expectedOut)} ${tokenOutSymbol}`);
    console.log(`   Min (${slippage * 100}% slippage): ${ethers.formatEther(minAmountOut)} ${tokenOutSymbol}`);
    
    console.log(`\n🔄 Executing...`);
    const result = await executeV2Swap(signer, pairInfo.address, tokenIn, tokenOut, amountIn, minAmountOut);
    
    console.log(`\n✅ Swap complete!`);
    console.log(`   Tx: ${result.hash}`);
    console.log(`   Got: ${ethers.formatEther(result.amountOut)} ${tokenOutSymbol}`);
  }
}

main().catch(console.error);
