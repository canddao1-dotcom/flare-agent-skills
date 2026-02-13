#!/usr/bin/env node
/**
 * BANK Rate - LP price vs Contract rate comparison
 */

const { ethers } = require('ethers');

const RPC_URL = 'https://flare-api.flare.network/ext/C/rpc';

// Contracts
const BANK_TOKEN = '0x194726F6C2aE988f1Ab5e1C943c17e591a6f6059';
const BANK_WFLR_PAIR = '0x5f29c8d049e47dd180c2b83e3560e8e271110335';
const FLARE_REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');

  // Get FLR price from FTSO
  let flrPrice = 0;
  try {
    const registry = new ethers.Contract(FLARE_REGISTRY, [
      'function getContractAddressByName(string) view returns (address)',
    ], provider);
    const ftsoV2Addr = await registry.getContractAddressByName('FtsoV2');
    const ftsoV2 = new ethers.Contract(ftsoV2Addr, [
      'function getFeedById(bytes21) view returns (uint256 value, int8 decimals, uint64 timestamp)',
    ], provider);
    
    const feedId = '0x01' + Buffer.from('FLR/USD').toString('hex').padEnd(40, '0');
    const [value, decimals] = await ftsoV2.getFeedById(feedId);
    flrPrice = parseFloat(value.toString()) / Math.pow(10, Math.abs(Number(decimals)));
  } catch (e) {
    console.error('Warning: Could not fetch FLR price:', e.message);
  }

  // Get LP reserves (BANK/WFLR)
  const pair = new ethers.Contract(BANK_WFLR_PAIR, [
    'function getReserves() view returns (uint112, uint112, uint32)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
  ], provider);

  const [reserves, token0] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
  ]);

  // Determine which reserve is BANK vs WFLR
  const isBANKToken0 = token0.toLowerCase() === BANK_TOKEN.toLowerCase();
  const reserveBANK = parseFloat(ethers.formatEther(isBANKToken0 ? reserves[0] : reserves[1]));
  const reserveWFLR = parseFloat(ethers.formatEther(isBANKToken0 ? reserves[1] : reserves[0]));

  // LP price: WFLR per BANK
  const lpPriceInWFLR = reserveWFLR / reserveBANK;
  const lpPriceInUSD = lpPriceInWFLR * flrPrice;

  // Get contract rates
  const bank = new ethers.Contract(BANK_TOKEN, [
    'function buyPrice() view returns (uint256)',
    'function sellPrice() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function calculateTokensReceived(uint256) view returns (uint256)',
    'function calculateEthereumReceived(uint256) view returns (uint256)',
  ], provider);

  const [buyPriceRaw, sellPriceRaw, totalSupply, tokensFor1FLR, wflrFor1BANK] = await Promise.all([
    bank.buyPrice(),
    bank.sellPrice(),
    bank.totalSupply(),
    bank.calculateTokensReceived(ethers.parseEther('1')).catch(() => 0n),
    bank.calculateEthereumReceived(ethers.parseEther('1')).catch(() => 0n),
  ]);

  // Contract prices:
  // - buyPrice() is the base rate (WFLR per BANK)
  // - calculateTokensReceived/calculateEthereumReceived give actual rates after fees
  const baseBuyPrice = parseFloat(ethers.formatEther(buyPriceRaw));
  const baseSellPrice = parseFloat(ethers.formatEther(sellPriceRaw));
  
  // Actual rates from calculation functions (includes 10% fee + slippage)
  const tokensReceived = parseFloat(ethers.formatEther(tokensFor1FLR));
  const contractBuyPrice = tokensReceived > 0 ? 1 / tokensReceived : baseBuyPrice; // Actual cost per BANK
  const contractSellPrice = parseFloat(ethers.formatEther(wflrFor1BANK)) || (baseBuyPrice * 0.9); // Actual WFLR received
  
  const supply = parseFloat(ethers.formatEther(totalSupply));

  // Calculate spreads (sell should be ~10% below buy due to dividend fee)
  const contractSpread = ((contractBuyPrice - contractSellPrice) / contractBuyPrice) * 100;
  const lpVsBuyPremium = ((lpPriceInWFLR - contractBuyPrice) / contractBuyPrice) * 100;
  const lpVsSellPremium = ((lpPriceInWFLR - contractSellPrice) / contractSellPrice) * 100;

  if (jsonOutput) {
    console.log(JSON.stringify({
      lpPrice: { wflr: lpPriceInWFLR, usd: lpPriceInUSD },
      contractBuyPrice: { wflr: contractBuyPrice, usd: contractBuyPrice * flrPrice },
      contractSellPrice: { wflr: contractSellPrice, usd: contractSellPrice * flrPrice },
      spread: contractSpread,
      lpVsBuy: lpVsBuyPremium,
      lpVsSell: lpVsSellPremium,
      reserves: { bank: reserveBANK, wflr: reserveWFLR },
      totalSupply: supply,
      flrPrice,
    }, null, 2));
    return;
  }

  // Display
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('           📊 BANK RATE CHECK');
  console.log('═══════════════════════════════════════════');
  console.log('');
  
  console.log('💱 LP PRICE (Enosys V2)');
  console.log(`   ${lpPriceInWFLR.toFixed(6)} WFLR per BANK`);
  if (flrPrice > 0) {
    console.log(`   $${lpPriceInUSD.toFixed(6)} USD`);
  }
  console.log('');
  
  console.log('🏦 CONTRACT RATES (FlareBank)');
  console.log(`   Base Rate: ${baseBuyPrice.toFixed(4)} WFLR/BANK`);
  console.log(`   Buy (after fees):  ${contractBuyPrice.toFixed(4)} WFLR per BANK`);
  if (flrPrice > 0) {
    console.log(`                      $${(contractBuyPrice * flrPrice).toFixed(6)} USD`);
  }
  console.log(`   Sell (after 10%):  ${contractSellPrice.toFixed(4)} WFLR per BANK`);
  if (flrPrice > 0) {
    console.log(`                      $${(contractSellPrice * flrPrice).toFixed(6)} USD`);
  }
  console.log(`   Spread: ${contractSpread.toFixed(2)}%`);
  console.log('');
  
  console.log('📈 LP vs CONTRACT');
  const buyArrow = lpVsBuyPremium >= 0 ? '↑' : '↓';
  const sellArrow = lpVsSellPremium >= 0 ? '↑' : '↓';
  console.log(`   LP vs Buy:  ${lpVsBuyPremium >= 0 ? '+' : ''}${lpVsBuyPremium.toFixed(2)}% ${buyArrow}`);
  console.log(`   LP vs Sell: ${lpVsSellPremium >= 0 ? '+' : ''}${lpVsSellPremium.toFixed(2)}% ${sellArrow}`);
  console.log('');
  
  // Arbitrage hints
  if (lpVsBuyPremium < -1) {
    console.log('💡 OPPORTUNITY: LP cheaper than contract buy');
    console.log('   → Buy on LP, potentially sell to contract');
  } else if (lpVsSellPremium > 1) {
    console.log('💡 OPPORTUNITY: LP more expensive than contract sell');
    console.log('   → Buy from contract, sell on LP');
  }
  
  console.log('');
  console.log('📊 POOL STATS');
  console.log(`   Reserves: ${reserveBANK.toFixed(2)} BANK + ${reserveWFLR.toFixed(2)} WFLR`);
  console.log(`   Total BANK Supply: ${supply.toFixed(2)}`);
  if (flrPrice > 0) {
    const poolTVL = reserveWFLR * 2 * flrPrice;
    console.log(`   Pool TVL: ~$${poolTVL.toFixed(2)}`);
  }
  console.log('');
}

main().catch(console.error);
