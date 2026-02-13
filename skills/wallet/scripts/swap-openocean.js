#!/usr/bin/env node
/**
 * OpenOcean DEX Aggregator - Best rates across Flare DEXs
 * Routes through SparkDex V3, Enosys V3, Blazeswap, etc.
 */

const https = require('https');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// OpenOcean API
const OPENOCEAN_API = 'https://open-api.openocean.finance/v4/14';
const OPENOCEAN_ROUTER = '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64';

// Token addresses
const TOKENS = {
  WFLR: { address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d', decimals: 18 },
  FLR: { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18 }, // Native
  FXRP: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', decimals: 6 },
  sFLR: { address: '0x12e605bc104e93B45e1aD99F9e555f659051c2BB', decimals: 18 },
  rFLR: { address: '0x26d460c3Cf931Fb2014FA436a49e3Af08619810e', decimals: 18 },
  'USD₮0': { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
  USDT0: { address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', decimals: 6 },
  'USDC.e': { address: '0xfbda5f676cb37624f28265a144a48b0d6e87d3b6', decimals: 6 },
  CDP: { address: '0x6Cd3a5Ba46FA254D4d2E3C2B37350ae337E94a0F', decimals: 18 },
  BANK: { address: '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059', decimals: 18 },
  stXRP: { address: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', decimals: 6 }
};

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

// HTTP fetch helper
function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Flare-Agent/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

// Get quote from OpenOcean
async function getQuote(fromToken, toToken, amount, slippage = 1) {
  const fromInfo = TOKENS[fromToken] || { address: fromToken, decimals: 18 };
  const toInfo = TOKENS[toToken] || { address: toToken, decimals: 18 };
  
  // OpenOcean API expects human-readable amounts (NOT wei)
  const url = `${OPENOCEAN_API}/quote?` + new URLSearchParams({
    inTokenAddress: fromInfo.address,
    outTokenAddress: toInfo.address,
    amount: amount.toString(),
    gasPrice: '25',
    slippage: slippage.toString()
  });
  
  const result = await fetch(url);
  
  if (result.code !== 200) {
    throw new Error(`Quote failed: ${JSON.stringify(result)}`);
  }
  
  return {
    fromToken,
    toToken,
    fromAmount: amount,
    toAmount: ethers.formatUnits(result.data.outAmount, toInfo.decimals),
    estimatedGas: result.data.estimatedGas,
    dexes: result.data.dexes,
    price: parseFloat(ethers.formatUnits(result.data.outAmount, toInfo.decimals)) / amount,
    fromInfo,
    toInfo,
    raw: result.data
  };
}

// Get swap transaction data
async function getSwapData(fromToken, toToken, amount, slippage, account) {
  const fromInfo = TOKENS[fromToken] || { address: fromToken, decimals: 18 };
  const toInfo = TOKENS[toToken] || { address: toToken, decimals: 18 };
  
  // OpenOcean API expects human-readable amounts (NOT wei)
  const url = `${OPENOCEAN_API}/swap?` + new URLSearchParams({
    inTokenAddress: fromInfo.address,
    outTokenAddress: toInfo.address,
    amount: amount.toString(),
    gasPrice: '25',
    slippage: slippage.toString(),
    account: account,
    referrer: '0x0000000000000000000000000000000000000000'
  });
  
  const result = await fetch(url);
  
  if (result.code !== 200) {
    throw new Error(`Swap data failed: ${JSON.stringify(result)}`);
  }
  
  return result.data;
}

// Check token allowance
async function checkAllowance(provider, tokenAddress, owner, spender) {
  if (tokenAddress === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
    return ethers.MaxUint256; // Native token, no approval needed
  }
  
  const token = new ethers.Contract(tokenAddress, [
    'function allowance(address owner, address spender) view returns (uint256)'
  ], provider);
  
  return await token.allowance(owner, spender);
}

// Approve token spending
async function approveToken(wallet, tokenAddress, spender, amount) {
  const token = new ethers.Contract(tokenAddress, [
    'function approve(address spender, uint256 amount) returns (bool)'
  ], wallet);
  
  console.log(`\n🔓 Approving ${spender} to spend tokens...`);
  const tx = await token.approve(spender, amount);
  console.log(`   Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`   ✅ Approved in block ${receipt.blockNumber}`);
  return receipt;
}

// Load keystore (supports both plain JSON with privateKey and encrypted keystores)
async function loadWallet(keystorePath, provider) {
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  
  // Plain JSON format with privateKey field
  if (keystore.privateKey) {
    return new ethers.Wallet(keystore.privateKey, provider);
  }
  
  // Encrypted keystore format
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await new Promise(resolve => {
    rl.question('🔐 Keystore password: ', answer => {
      rl.close();
      resolve(answer);
    });
  });
  
  console.log('🔓 Decrypting wallet...');
  const wallet = await ethers.Wallet.fromEncryptedJson(JSON.stringify(keystore), password);
  return wallet.connect(provider);
}

// Execute swap
async function executeSwap(wallet, swapData, fromToken) {
  const isNative = fromToken === 'FLR' || 
    TOKENS[fromToken]?.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
  
  const tx = {
    to: swapData.to,
    data: swapData.data,
    value: isNative ? swapData.value : '0',
    gasLimit: Math.floor(parseInt(swapData.estimatedGas) * 1.3)
  };
  
  console.log(`\n🔄 Sending swap transaction...`);
  console.log(`   Router: ${tx.to}`);
  console.log(`   Gas Limit: ${tx.gasLimit}`);
  console.log(`   Data length: ${tx.data?.length || 0} bytes`);
  
  const response = await wallet.sendTransaction(tx);
  console.log(`   Tx Hash: ${response.hash}`);
  console.log(`   ⏳ Waiting for confirmation...`);
  
  const receipt = await response.wait();
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
  
  return receipt;
}

// Format route display
function formatRoutes(dexes) {
  if (!dexes || dexes.length === 0) return 'Direct';
  return dexes.map(d => `${d.dexCode}`).join(' + ');
}

// Main
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
OpenOcean DEX Aggregator for Flare
===================================
Routes through SparkDex V3, Enosys V3, Blazeswap for best rates.

Usage:
  node swap-openocean.js quote --from <TOKEN> --to <TOKEN> --amount <N>
  node swap-openocean.js swap --keystore <PATH> --from <TOKEN> --to <TOKEN> --amount <N> [--slippage <N>]

Examples:
  # Get quote
  node swap-openocean.js quote --from WFLR --to FXRP --amount 100
  
  # Execute swap
  node swap-openocean.js swap --keystore ./keystore.json --from WFLR --to FXRP --amount 100 --slippage 1

Tokens: ${Object.keys(TOKENS).join(', ')}

Router: ${OPENOCEAN_ROUTER}
`);
    return;
  }
  
  const command = args[0];
  const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : null;
  };
  
  const fromToken = getArg('from')?.toUpperCase();
  const toToken = getArg('to')?.toUpperCase();
  const amount = parseFloat(getArg('amount') || '0');
  const slippage = parseFloat(getArg('slippage') || '1');
  const keystorePath = getArg('keystore');
  
  if (!fromToken || !toToken || !amount) {
    console.error('❌ Missing required arguments: --from, --to, --amount');
    process.exit(1);
  }
  
  if (command === 'quote') {
    console.log(`\n🔍 Getting quote: ${amount} ${fromToken} → ${toToken}`);
    console.log(`   Slippage: ${slippage}%`);
    
    const quote = await getQuote(fromToken, toToken, amount, slippage);
    
    console.log(`\n📊 Quote Result:`);
    console.log(`   Input:  ${quote.fromAmount} ${fromToken}`);
    console.log(`   Output: ${parseFloat(quote.toAmount).toFixed(6)} ${toToken}`);
    console.log(`   Rate:   1 ${fromToken} = ${quote.price.toFixed(6)} ${toToken}`);
    console.log(`   Route:  ${formatRoutes(quote.dexes)}`);
    console.log(`   Gas:    ~${quote.estimatedGas}`);
    
    // Show DEX breakdown
    if (quote.dexes && quote.dexes.length > 1) {
      const totalSwap = quote.dexes.reduce((sum, d) => sum + parseInt(d.swapAmount), 0);
      console.log(`\n   📈 DEX Split:`);
      for (const dex of quote.dexes) {
        const pct = (parseInt(dex.swapAmount) / totalSwap * 100).toFixed(1);
        console.log(`      ${dex.dexCode}: ${pct}%`);
      }
    }
    
    return;
  }
  
  if (command === 'swap') {
    if (!keystorePath) {
      console.error('❌ Swap requires --keystore');
      process.exit(1);
    }
    
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = await loadWallet(keystorePath, provider);
    
    console.log(`\n👛 Wallet: ${wallet.address}`);
    
    // Get quote first
    console.log(`\n🔍 Getting quote: ${amount} ${fromToken} → ${toToken}`);
    const quote = await getQuote(fromToken, toToken, amount, slippage);
    
    console.log(`\n📊 Swap Preview:`);
    console.log(`   Input:  ${quote.fromAmount} ${fromToken}`);
    console.log(`   Output: ~${parseFloat(quote.toAmount).toFixed(6)} ${toToken}`);
    console.log(`   Min:    ${(parseFloat(quote.toAmount) * (100 - slippage) / 100).toFixed(6)} ${toToken} (${slippage}% slippage)`);
    console.log(`   Route:  ${formatRoutes(quote.dexes)}`);
    
    // Check allowance for non-native tokens
    const fromInfo = TOKENS[fromToken] || { address: fromToken, decimals: 18 };
    const isNative = fromToken === 'FLR' || fromInfo.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    
    if (!isNative) {
      const amountWei = ethers.parseUnits(amount.toString(), fromInfo.decimals);
      const allowance = await checkAllowance(provider, fromInfo.address, wallet.address, OPENOCEAN_ROUTER);
      
      if (allowance < amountWei) {
        console.log(`\n⚠️  Insufficient allowance. Need approval.`);
        await approveToken(wallet, fromInfo.address, OPENOCEAN_ROUTER, ethers.MaxUint256);
      } else {
        console.log(`\n✅ Allowance OK`);
      }
    }
    
    // Get swap data
    console.log(`\n📝 Building swap transaction...`);
    const swapData = await getSwapData(fromToken, toToken, amount, slippage, wallet.address);
    
    // Execute
    const receipt = await executeSwap(wallet, swapData, fromToken);
    
    console.log(`\n🎉 Swap complete!`);
    console.log(`   Explorer: https://flarescan.com/tx/${receipt.hash}`);
    
    return;
  }
  
  console.error(`❌ Unknown command: ${command}`);
  process.exit(1);
}

main().catch(err => {
  console.error(`\n❌ Error: ${err.message}`);
  process.exit(1);
});
